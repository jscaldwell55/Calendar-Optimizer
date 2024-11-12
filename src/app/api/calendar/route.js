import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import {
  addDays,
  addWeeks,
  addMonths,
  isWithinInterval,
  isWeekend,
  getDay,
  isSameDay,
  startOfDay,
  endOfDay,
  setHours,
  setMinutes,
  addMinutes,
  max as maxDate,
} from 'date-fns';

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

// Define time-themed quotes
const timeQuotes = [
  "The two most powerful warriors are patience and time. - Leo Tolstoy",
  "Time is the most valuable thing a man can spend. - Theophrastus",
  "Time is the wisest counselor of all. - Pericles", 
  "Time is the school in which we learn, time is the fire in which we burn. - Delmore Schwartz",
  "Time is the longest distance between two places. - Tennessee Williams"
];

// Helper to check if a date is within business hours
function isWithinBusinessHours(date) {
  const hours = date.getHours();
  return hours >= 9 && hours < 17;
}

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

    // Start from the next business day at 9:00 AM
    let timeMin = startOfDay(new Date());

    // If it's Friday after 5 PM, start from next Monday
    if (getDay(timeMin) === 5 && timeMin.getHours() >= 17) {
      timeMin = addDays(timeMin, 3);
    }
    // If it's Saturday, start from next Monday
    else if (getDay(timeMin) === 6) {
      timeMin = addDays(timeMin, 2);
    }
    // If it's Sunday, start from next Monday
    else if (getDay(timeMin) === 0) {
      timeMin = addDays(timeMin, 1);
    }
    // If it's a weekday after 5 PM, start from the next day
    else if (timeMin.getHours() >= 17) {
      timeMin = addDays(timeMin, 1);
    }

    timeMin = setHours(timeMin, 9);
    timeMin = setMinutes(timeMin, 0);

    // Calculate timeMax based on search range
    let timeMax;
    switch (searchRange) {
      case 'hour':
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

    console.log('Searching for available slots between:', {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString()
    });

    // Get all-day events
    const eventsResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay(timeMin).toISOString(),
      timeMax: endOfDay(timeMax).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const allDayEvents = eventsResponse.data.items
      .filter(event => event.start.date != null)
      .map(event => ({
        start: new Date(event.start.date),
        end: new Date(event.end.date)
      }));

    console.log('All-day events found:', allDayEvents);

    // Get free/busy information
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

    console.log('Busy periods found:', busyPeriods);

    // Find available slots
    const availableSlots = [];
    const slotDuration = duration * 60 * 1000;
    let currentTime = timeMin;

    while (availableSlots.length < 5 && currentTime < timeMax) {
      const slotStart = maxDate([currentTime, timeMin]); // Ensure slot starts within search range
      const slotEnd = addMinutes(slotStart, duration);

      console.log('Checking slot:', {
        start: slotStart.toLocaleString(),
        end: slotEnd.toLocaleString()
      });

      // Ensure slot is within business hours
      if (!isWithinBusinessHours(slotStart) || !isWithinBusinessHours(slotEnd)) {
        console.log('Slot outside business hours, skipping');
        currentTime = addDays(slotStart, 1);
        currentTime = setHours(currentTime, 9);
        currentTime = setMinutes(currentTime, 0);
        continue;
      }

      // Skip weekends
      if (isWeekend(slotStart)) {
        console.log('Weekend detected, moving to next business day');
        currentTime = addDays(slotStart, slotStart.getDay() === 6 ? 2 : 1);
        currentTime = setHours(currentTime, 9);
        currentTime = setMinutes(currentTime, 0);
        continue;
      }

      // Skip holidays
      if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) {
        console.log('Holiday detected, moving to next business day');
        currentTime = addDays(slotStart, 1);
        currentTime = setHours(currentTime, 9);
        currentTime = setMinutes(currentTime, 0);
        continue; 
      }
      
      // Skip Fridays if specified 
      if (preferences.noFridays && getDay(slotStart) === 5) {
        console.log('Friday detected, skipping due to preferences');
        currentTime = addDays(slotStart, 3);
        currentTime = setHours(currentTime, 9);  
        currentTime = setMinutes(currentTime, 0);
        continue;
      }

      // Skip all-day events
      const isAllDayEvent = allDayEvents.some(event =>
        slotStart >= startOfDay(event.start) && slotStart < startOfDay(event.end)
      );

      if (isAllDayEvent) {
        console.log('All-day event detected, moving to next business day');
        currentTime = addDays(slotStart, 1);
        currentTime = setHours(currentTime, 9);
        currentTime = setMinutes(currentTime, 0);
        continue;
      }

      // Check against busy periods  
      const isAvailable = !busyPeriods.some(busy => (
        isWithinInterval(slotStart, { start: busy.start, end: busy.end }) ||
        isWithinInterval(slotEnd, { start: busy.start, end: busy.end }) ||
        (slotStart <= busy.start && slotEnd >= busy.end)  
      ));

      if (isAvailable) {
        console.log('Available slot found:', {
          start: slotStart.toISOString(), 
          end: slotEnd.toISOString()
        });
        
        availableSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),  
        });
      }

      currentTime = addMinutes(slotEnd, 1); // Move to the next possible slot
    }

    // Select a random time quote
    const randomQuote = timeQuotes[Math.floor(Math.random() * timeQuotes.length)];

    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
        quote: randomQuote,
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
