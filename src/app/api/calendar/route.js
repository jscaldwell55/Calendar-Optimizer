import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addWeeks, addMonths, isWeekend, getDay, isSameDay, startOfDay, endOfDay, setHours, setMinutes } from 'date-fns';

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
    let timeMin = new Date(now);
    
    // Set to next 30-minute increment
    timeMin = new Date(Math.ceil(timeMin.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
    
    // Convert hours to local time for comparison
    const currentHour = timeMin.getHours();
    
    // If current time is outside business hours, move to next business day at 9 AM
    if (currentHour >= 17 || currentHour < 9) {
      timeMin = startOfDay(addDays(timeMin, 1));  // Move to start of next day
      timeMin = setHours(timeMin, 9);  // Set to 9 AM
      timeMin = setMinutes(timeMin, 0);  // Set to exact hour
    }

    // Calculate timeMax based on search range
    let timeMax;
    const timeMinDay = startOfDay(timeMin);
    switch (searchRange) {
      case 'day':
        timeMax = addDays(timeMinDay, 1);
        break;
      case 'week':
        timeMax = addWeeks(timeMinDay, 1);
        break;
      case 'month':
        timeMax = addMonths(timeMinDay, 1);
        break;
      default:
        timeMax = addDays(timeMinDay, 1);
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

// Initialize `timeMin` to the current date and time
let timeMin = new Date(); // Declare `timeMin` only once

// Adjust `timeMin` to start at the next available business hour if it's outside of 9 AM - 5 PM
const currentHour = timeMin.getHours();
if (currentHour >= 17 || currentHour < 9) {
  // Move to the start of the next day at 9 AM
  timeMin = startOfDay(addDays(timeMin, 1));
  timeMin = setHours(timeMin, 9);  // Set to 9 AM
  timeMin = setMinutes(timeMin, 0);  // Set minutes to 0
}

// Calculate `timeMax` based on the search range
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

// Find available slots
const availableSlots = [];
const slotDuration = duration * 60 * 1000;
const stepSize = 30 * 60 * 1000;

let currentTime = timeMin.getTime();
while (currentTime < timeMax.getTime() && availableSlots.length < 5) {
  const slotStart = new Date(currentTime);
  const slotEnd = new Date(currentTime + slotDuration);

  console.log('Checking slot:', {
    start: slotStart.toLocaleString(),
    end: slotEnd.toLocaleString()
  });

  // Ensure slot is within business hours
  if (!isWithinBusinessHours(slotStart) || !isWithinBusinessHours(slotEnd)) {
    console.log('Slot outside business hours, skipping');
    currentTime += stepSize;
    continue;
  }

  // Skip weekends
  if (isWeekend(slotStart)) {
    console.log('Weekend detected, moving to next business day');
    currentTime = startOfDay(addDays(slotStart, 1));
    currentTime = setHours(new Date(currentTime), 9).getTime();
    continue;
  }

  // Skip holidays
  if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) {
    console.log('Holiday detected, moving to next business day');
    currentTime = startOfDay(addDays(slotStart, 1));
    currentTime = setHours(new Date(currentTime), 9).getTime();
    continue;
  }

  // Skip Fridays if specified
  if (preferences.noFridays && getDay(slotStart) === 5) {
    console.log('Friday detected, skipping due to preferences');
    currentTime = startOfDay(addDays(slotStart, 1));
    currentTime = setHours(new Date(currentTime), 9).getTime();
    continue;
  }

  // Skip all-day events
  const isAllDayEvent = allDayEvents.some(event => {
    const eventStart = startOfDay(event.start);
    const eventEnd = startOfDay(event.end);
    return slotStart >= eventStart && slotStart < eventEnd;
  });

  if (isAllDayEvent) {
    console.log('All-day event detected, moving to next day');
    currentTime = startOfDay(addDays(slotStart, 1));
    currentTime = setHours(new Date(currentTime), 9).getTime();
    continue;
  }

  // Check against busy periods
  const isAvailable = !busyPeriods.some(busy => (
    (slotStart >= busy.start && slotStart < busy.end) ||
    (slotEnd > busy.start && slotEnd <= busy.end) ||
    (slotStart <= busy.start && slotEnd >= busy.end)
  ));

  if (isAvailable) {
    console.log('Available slot found:', {
      start: slotStart.toLocaleString(),
      end: slotEnd.toLocaleString()
    });
    
    availableSlots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
    });
  }

  currentTime += stepSize;
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
