import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addWeeks, addMonths, parseISO, isWithinInterval, isWeekend, getDay, isSameDay } from 'date-fns';

// Define US holidays in 2024
const usHolidays2024 = [
  new Date('2024-01-01'), // New Year's Day
  new Date('2024-01-15'), // Martin Luther King Jr. Day
  new Date('2024-02-19'), // Presidents' Day
  new Date('2024-05-27'), // Memorial Day
  new Date('2024-07-04'), // Independence Day
  new Date('2024-09-02'), // Labor Day
  new Date('2024-10-14'), // Columbus Day
  new Date('2024-11-11'), // Veterans Day
  new Date('2024-11-28'), // Thanksgiving Day
  new Date('2024-12-25'), // Christmas Day
];

export async function POST(req) {
  try {
    // Validate session and access token
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      console.log('No access token found in session:', session);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No access token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { attendees, searchRange, duration, preferences } = body;
    
    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Set time range with corrected cases
    const timeMin = new Date();
    let timeMax;
    switch (searchRange) {
      case 'day':
        timeMax = addDays(timeMin, 1);
        break;
      case 'week':
        timeMax = addWeeks(timeMin, 1);
        break;
      case 'month':
        timeMax = addMonths(timeMin, 1);
        break;
      default:
        timeMax = addDays(timeMin, 1);
    }

    // Get timezone from preferences or system default
    const userTimezone = preferences.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Query for busy periods
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [
          { id: 'primary' },
          ...attendees.map(email => ({ id: email }))
        ],
        timeZone: userTimezone,
      },
    });

    console.log('FreeBusy response:', JSON.stringify(freeBusy.data, null, 2));

    // Process and sort busy periods
    const busyPeriods = Object.values(freeBusy.data.calendars)
      .flatMap(calendar => calendar.busy || [])
      .map(period => ({
        start: new Date(period.start),
        end: new Date(period.end)
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find available slots
    const availableSlots = [];
    const slotDuration = duration * 60 * 1000; // Convert minutes to milliseconds
    const stepSize = 30 * 60 * 1000; // 30-minute intervals

    for (
      let currentTime = timeMin.getTime();
      currentTime < timeMax.getTime() && availableSlots.length < 10;
      currentTime += stepSize
    ) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime + slotDuration);

      // Convert times to user's timezone
      const slotStartInTz = new Date(slotStart.toLocaleString('en-US', { timeZone: userTimezone }));
      const slotEndInTz = new Date(slotEnd.toLocaleString('en-US', { timeZone: userTimezone }));

      const slotStartHours = slotStartInTz.getHours();
      const slotStartMinutes = slotStartInTz.getMinutes();
      const slotEndHours = slotEndInTz.getHours();
      const slotEndMinutes = slotEndInTz.getMinutes();

      // Debug logging
      console.log('Checking slot:', {
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        startHours: slotStartHours,
        endHours: slotEndHours,
        timezone: userTimezone
      });

      // Check business hours (9 AM - 5 PM)
      if (
        slotStartHours < 9 || 
        slotEndHours > 17 ||
        (slotEndHours === 17 && slotEndMinutes > 0)
      ) {
        console.log('Slot outside business hours, skipping');
        continue;
      }

      // Skip weekends
      if (isWeekend(slotStart)) {
        console.log('Slot on weekend, skipping');
        continue;
      }

      // Skip holidays
      if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) {
        console.log('Slot on holiday, skipping');
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && getDay(slotStart) === 5) {
        console.log('Slot on Friday, skipping due to preferences');
        continue;
      }

      // Improved busy period checking
      const isAvailable = !busyPeriods.some(busy => {
        const overlap = (
          (slotStart >= busy.start && slotStart < busy.end) ||  // Slot starts during busy period
          (slotEnd > busy.start && slotEnd <= busy.end) ||      // Slot ends during busy period
          (slotStart <= busy.start && slotEnd >= busy.end)      // Slot completely contains busy period
        );
        
        if (overlap) {
          console.log('Slot overlaps with busy period:', {
            slotStart: slotStart.toISOString(),
            slotEnd: slotEnd.toISOString(),
            busyStart: busy.start.toISOString(),
            busyEnd: busy.end.toISOString()
          });
        }
        
        return overlap;
      });

      if (isAvailable) {
        console.log('Found available slot:', {
          start: slotStart.toISOString(),
          end: slotEnd.toISOString()
        });
        
        availableSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }

    // Time-themed quotes for response
    const timeQuotes = [
      "Time is the most valuable thing a man can spend. - Theophrastus",
      "Time is what we want most, but what we use worst. - William Penn",
      "The future is something which everyone reaches at the rate of sixty minutes an hour. - C.S. Lewis",
      "Lost time is never found again. - Benjamin Franklin",
      "Time and tide wait for no man. - Geoffrey Chaucer"
    ];
    const randomQuote = timeQuotes[Math.floor(Math.random() * timeQuotes.length)];

    // Return successful response
    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
        quote: randomQuote,
        metadata: {
          searchRange,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timezone: userTimezone
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('General error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process request',
        details: error.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
