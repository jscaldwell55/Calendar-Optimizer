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
  parseISO,
  differenceInDays,
  differenceInWeeks,
  differenceInMonths,
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

const timeQuotes = [
  "The two most powerful warriors are patience and time. - Leo Tolstoy",
  "Time is the most valuable thing a man can spend. - Theophrastus",
  "Time is the wisest counselor of all. - Pericles",
  "Time is the school in which we learn, time is the fire in which we burn. - Delmore Schwartz",
  "Time is the longest distance between two places. - Tennessee Williams"
];

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const MAX_SUGGESTIONS = 10;

// Helper to check if a date is within business hours (9 AM - 5 PM)
function isWithinBusinessHours(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return (hours === BUSINESS_START_HOUR && minutes >= 0) || 
         (hours > BUSINESS_START_HOUR && hours < BUSINESS_END_HOUR) ||
         (hours === BUSINESS_END_HOUR && minutes === 0);
}

// Helper to get next valid business day start
function getNextBusinessDayStart(date) {
  let nextDay = startOfDay(date);
  
  // If current time is past business hours, move to next day
  if (date.getHours() >= BUSINESS_END_HOUR) {
    nextDay = addDays(nextDay, 1);
  }
  
  // Skip weekends and holidays
  while (isWeekend(nextDay) || usHolidays2024.some(holiday => isSameDay(nextDay, holiday))) {
    nextDay = addDays(nextDay, 1);
  }
  
  return setMinutes(setHours(nextDay, BUSINESS_START_HOUR), 0);
}

// Helper to calculate duration end date
function calculateEndDate(startDate, durationType) {
  switch (durationType) {
    case '1440': // 1 day
      return endOfDay(startDate);
    case '10080': // 1 week
      return endOfDay(addDays(startDate, 6));
    case '43200': // 1 month (approximate)
      return endOfDay(addMonths(startDate, 1));
    default:
      return endOfDay(startDate);
  }
}

// Helper to check if a period includes holidays or weekends
function includesHolidaysOrWeekends(start, end) {
  const days = differenceInDays(end, start);
  
  for (let i = 0; i <= days; i++) {
    const currentDate = addDays(start, i);
    if (isWeekend(currentDate) || 
        usHolidays2024.some(holiday => isSameDay(currentDate, holiday))) {
      return true;
    }
  }
  return false;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No access token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { attendees, searchRange, duration: durationStr, preferences } = body;
    
    // Convert duration string to minutes
    const duration = {
      '1440': 1440,  // 1 day
      '10080': 10080, // 1 week
      '43200': 43200  // 1 month (approximate)
    }[durationStr] || 1440;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Set search start time to next available business day
    const timeMin = getNextBusinessDayStart(new Date());

    // Calculate search end time based on range
    let timeMax;
    switch (searchRange) {
      case 'hour':
        timeMax = addDays(timeMin, 7); // Extended to give enough room for longer durations
        break;
      case 'week':
        timeMax = addMonths(timeMin, 1);
        break;
      case 'month':
        timeMax = addMonths(timeMin, 3);
        break;
      default:
        timeMax = addMonths(timeMin, 1);
    }

    // Get all-day events
    const eventsResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const allDayEvents = eventsResponse.data.items
      .filter(event => event.start.date != null)
      .map(event => ({
        start: parseISO(event.start.date),
        end: parseISO(event.end.date)
      }));

    // Get free/busy information for all attendees
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [
          { id: 'primary' },
          ...attendees.map(email => ({ id: email }))
        ],
      },
    });

    const busyPeriods = Object.values(freeBusy.data.calendars)
      .flatMap(calendar => calendar.busy || [])
      .map(period => ({
        start: new Date(period.start),
        end: new Date(period.end)
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find available slots
    const availableSlots = [];
    let currentTime = timeMin;

    while (availableSlots.length < MAX_SUGGESTIONS && currentTime < timeMax) {
      const slotEnd = calculateEndDate(currentTime, durationStr);

      // Skip if slot includes weekends or holidays (for multi-day periods)
      if (duration >= 1440 && includesHolidaysOrWeekends(currentTime, slotEnd)) {
        currentTime = getNextBusinessDayStart(addDays(currentTime, 1));
        continue;
      }

      // Skip if it's a Friday and noFridays is true
      if (preferences.noFridays && getDay(currentTime) === 5) {
        currentTime = getNextBusinessDayStart(addDays(currentTime, 3)); // Skip to Monday
        continue;
      }

      // Skip if there's an all-day event
      const hasAllDayEvent = allDayEvents.some(event =>
        isWithinInterval(currentTime, { 
          start: startOfDay(event.start), 
          end: endOfDay(event.end) 
        }) ||
        isWithinInterval(slotEnd, {
          start: startOfDay(event.start),
          end: endOfDay(event.end)
        })
      );

      if (hasAllDayEvent) {
        currentTime = getNextBusinessDayStart(addDays(currentTime, 1));
        continue;
      }

      // Check if slot conflicts with any busy periods
      const isSlotAvailable = !busyPeriods.some(busy =>
        isWithinInterval(currentTime, { start: busy.start, end: busy.end }) ||
        isWithinInterval(slotEnd, { start: busy.start, end: busy.end }) ||
        (currentTime <= busy.start && slotEnd >= busy.end)
      );

      if (isSlotAvailable) {
        availableSlots.push({
          start: currentTime.toISOString(),
          end: slotEnd.toISOString(),
        });
        currentTime = getNextBusinessDayStart(addDays(currentTime, 1));
      } else {
        // Move to the end of the conflicting busy period
        const conflictingPeriod = busyPeriods.find(busy =>
          isWithinInterval(currentTime, { start: busy.start, end: busy.end }) ||
          currentTime <= busy.start
        );
        currentTime = conflictingPeriod ? 
          getNextBusinessDayStart(new Date(conflictingPeriod.end)) : 
          getNextBusinessDayStart(addDays(currentTime, 1));
      }
    }

    // Select a random quote
    const randomQuote = timeQuotes[Math.floor(Math.random() * timeQuotes.length)];

    return new Response(
      JSON.stringify({
        suggestions: availableSlots.slice(0, MAX_SUGGESTIONS),
        quote: randomQuote,
        metadata: {
          searchRange,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing calendar request:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process request',
        details: error.message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
