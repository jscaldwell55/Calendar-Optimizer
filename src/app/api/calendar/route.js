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
} from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime, formatInTimeZone } from 'date-fns-tz';

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

// Helper to get US holidays adjusted for timezone
function getHolidaysForTimezone(timezone) {
  return [
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
  ].map(date => utcToZonedTime(date, timezone));
}

// Helper to convert UTC date to user's timezone
function utcToUserLocal(date, timezone) {
  return utcToZonedTime(date, timezone);
}

// Helper to convert user's local date to UTC
function userLocalToUtc(date, timezone) {
  return zonedTimeToUtc(date, timezone);
}

// Helper to check if a date is within business hours in user's timezone
function isWithinBusinessHours(utcDate, timezone) {
  const localDate = utcToUserLocal(utcDate, timezone);
  const hours = localDate.getHours();
  const minutes = localDate.getMinutes();
  return (hours === BUSINESS_START_HOUR && minutes >= 0) || 
         (hours > BUSINESS_START_HOUR && hours < BUSINESS_END_HOUR) ||
         (hours === BUSINESS_END_HOUR && minutes === 0);
}

// Helper to get next valid business day start in user's timezone
function getNextBusinessDayStart(utcDate, timezone) {
  const holidays = getHolidaysForTimezone(timezone);
  let localDate = utcToUserLocal(utcDate, timezone);
  let nextDay = startOfDay(localDate);
  
  // If current time is past business hours, move to next day
  if (localDate.getHours() >= BUSINESS_END_HOUR) {
    nextDay = addDays(nextDay, 1);
  }
  
  // Skip weekends and holidays
  while (isWeekend(nextDay) || holidays.some(holiday => isSameDay(nextDay, holiday))) {
    nextDay = addDays(nextDay, 1);
  }
  
  // Set to business start hour and convert back to UTC
  const localBusinessStart = setMinutes(setHours(nextDay, BUSINESS_START_HOUR), 0);
  return userLocalToUtc(localBusinessStart, timezone);
}

// Helper to calculate duration end date
function calculateEndDate(startUtc, durationType, timezone) {
  const startLocal = utcToUserLocal(startUtc, timezone);
  let endLocal;
  
  switch (durationType) {
    case '1440': // 1 day
      endLocal = endOfDay(startLocal);
      break;
    case '10080': // 1 week
      endLocal = endOfDay(addDays(startLocal, 6));
      break;
    case '43200': // 1 month
      endLocal = endOfDay(addMonths(startLocal, 1));
      break;
    default:
      endLocal = endOfDay(startLocal);
  }
  
  return userLocalToUtc(endLocal, timezone);
}

// Helper to check if a period includes holidays or weekends
function includesHolidaysOrWeekends(startUtc, endUtc, timezone) {
  const holidays = getHolidaysForTimezone(timezone);
  const startLocal = utcToUserLocal(startUtc, timezone);
  const endLocal = utcToUserLocal(endUtc, timezone);
  const days = differenceInDays(endLocal, startLocal);
  
  for (let i = 0; i <= days; i++) {
    const currentDate = addDays(startLocal, i);
    if (isWeekend(currentDate) || 
        holidays.some(holiday => isSameDay(currentDate, holiday))) {
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
    const { 
      attendees, 
      searchRange, 
      duration: durationStr, 
      preferences,
      timezone // Now required from client
    } = body;

    if (!timezone) {
      return new Response(
        JSON.stringify({ error: 'Timezone is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
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

    // Set search start time to next available business day (in UTC)
    const timeMin = getNextBusinessDayStart(new Date(), timezone);

    // Calculate search end time based on range (in UTC)
    let timeMax;
    switch (searchRange) {
      case 'hour':
        timeMax = addDays(timeMin, 7);
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

    // Get all-day events with user's timezone
    const eventsResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: timezone,
    });

    const allDayEvents = eventsResponse.data.items
      .filter(event => event.start.date != null)
      .map(event => ({
        start: parseISO(event.start.date + 'T00:00:00'),
        end: parseISO(event.end.date + 'T00:00:00')
      }));

    // Get free/busy information for all attendees in user's timezone
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: timezone,
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
      const slotEnd = calculateEndDate(currentTime, durationStr, timezone);
      const currentLocal = utcToUserLocal(currentTime, timezone);

      // Skip if slot includes weekends or holidays (for multi-day periods)
      if (duration >= 1440 && includesHolidaysOrWeekends(currentTime, slotEnd, timezone)) {
        currentTime = getNextBusinessDayStart(addDays(currentLocal, 1), timezone);
        continue;
      }

      // Skip if it's a Friday and noFridays is true
      if (preferences.noFridays && getDay(currentLocal) === 5) {
        currentTime = getNextBusinessDayStart(addDays(currentLocal, 3), timezone);
        continue;
      }

      // Skip if there's an all-day event
      const hasAllDayEvent = allDayEvents.some(event =>
        isWithinInterval(currentLocal, { 
          start: startOfDay(event.start), 
          end: endOfDay(event.end) 
        }) ||
        isWithinInterval(utcToUserLocal(slotEnd, timezone), {
          start: startOfDay(event.start),
          end: endOfDay(event.end)
        })
      );

      if (hasAllDayEvent) {
        currentTime = getNextBusinessDayStart(addDays(currentLocal, 1), timezone);
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
          localStart: formatInTimeZone(currentTime, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
          localEnd: formatInTimeZone(slotEnd, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")
        });
        currentTime = getNextBusinessDayStart(addDays(currentLocal, 1), timezone);
      } else {
        const conflictingPeriod = busyPeriods.find(busy =>
          isWithinInterval(currentTime, { start: busy.start, end: busy.end }) ||
          currentTime <= busy.start
        );
        currentTime = conflictingPeriod ? 
          getNextBusinessDayStart(new Date(conflictingPeriod.end), timezone) : 
          getNextBusinessDayStart(addDays(currentLocal, 1), timezone);
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
          timezone: timezone
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
