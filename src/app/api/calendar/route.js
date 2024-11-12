import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addWeeks, addMonths, isWeekend, getDay, isSameDay } from 'date-fns';

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
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      console.log('No access token found in session:', session);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No access token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { attendees, searchRange, duration, preferences } = body;
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Start from the next 30-minute increment
    const now = new Date();
    const currentMinutes = now.getMinutes();
    const nextSlotMinutes = Math.ceil(currentMinutes / 30) * 30;
    const timeMin = new Date(now);
    timeMin.setMinutes(nextSlotMinutes);
    timeMin.setSeconds(0);
    timeMin.setMilliseconds(0);

    // If we're past 5 PM, start from 9 AM next day
    if (timeMin.getHours() >= 17) {
      timeMin.setDate(timeMin.getDate() + 1);
      timeMin.setHours(9);
      timeMin.setMinutes(0);
    }
    // If we're before 9 AM, start at 9 AM
    else if (timeMin.getHours() < 9) {
      timeMin.setHours(9);
      timeMin.setMinutes(0);
    }

    let timeMax;
    switch (searchRange) {
      case 'day':
        timeMax = addDays(new Date(timeMin), 1);
        break;
      case 'week':
        timeMax = addWeeks(new Date(timeMin), 1);
        break;
      case 'month':
        timeMax = addMonths(new Date(timeMin), 1);
        break;
      default:
        timeMax = addDays(new Date(timeMin), 1);
    }

    // Set timeMax to 5 PM of its day
    timeMax.setHours(17);
    timeMax.setMinutes(0);
    timeMax.setSeconds(0);
    timeMax.setMilliseconds(0);

    console.log('Searching between:', {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString()
    });

    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [
          { id: 'primary' },
          ...attendees.map(email => ({ id: email }))
        ],
        timeZone: 'system',
      },
    });

    const busyPeriods = Object.values(freeBusy.data.calendars)
      .flatMap(calendar => calendar.busy || [])
      .map(period => ({
        start: new Date(period.start),
        end: new Date(period.end)
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    console.log('Busy periods:', busyPeriods);

    const availableSlots = [];
    const slotDuration = duration * 60 * 1000; // Convert minutes to milliseconds
    const stepSize = 30 * 60 * 1000; // 30-minute increments

    for (
      let currentTime = timeMin.getTime();
      currentTime < timeMax.getTime() && availableSlots.length < 10;
      currentTime += stepSize
    ) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime + slotDuration);

      // Skip if slot ends after 5 PM
      if (slotEnd.getHours() >= 17) {
        continue;
      }

      // Skip weekends
      if (isWeekend(slotStart)) {
        continue;
      }

      // Skip holidays
      if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) {
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && getDay(slotStart) === 5) {
        continue;
      }

      const isAvailable = !busyPeriods.some(busy => (
        (slotStart >= busy.start && slotStart < busy.end) ||
        (slotEnd > busy.start && slotEnd <= busy.end) ||
        (slotStart <= busy.start && slotEnd >= busy.end)
      ));

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

    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
        metadata: {
          searchRange,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timezone: 'system'
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
