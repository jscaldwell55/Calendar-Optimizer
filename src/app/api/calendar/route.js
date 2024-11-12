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
  format,
  addMinutes
} from 'date-fns';
import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const MAX_SUGGESTIONS = 5; // Changed to 5

// US Holidays 2024
const US_HOLIDAYS_2024 = [
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

// Time-themed quotes (using your original ones)
const timeQuotes = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

// Helper function for 12-hour time format
function formatAMPM(date, timezone) {
  const localDate = new Date(formatInTimeZone(date, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"));
  let hours = localDate.getHours();
  let minutes = localDate.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

// Helper to check if date is a holiday
function isHoliday(date) {
  return US_HOLIDAYS_2024.some(holiday => isSameDay(date, holiday));
}

// Helper to get the start of next business day at 9 AM in user's timezone
function getNextBusinessDayStart(timezone) {
  const now = new Date();
  const currentHour = parseInt(formatInTimeZone(now, timezone, 'H'));
  
  let baseDate = startOfDay(now);
  if (currentHour >= BUSINESS_END_HOUR) {
    baseDate = addDays(baseDate, 1);
  }
  
  // Skip weekends and holidays
  while (isWeekend(baseDate) || isHoliday(baseDate)) {
    baseDate = addDays(baseDate, 1);
  }
  
  const businessStart = `${format(baseDate, 'yyyy-MM-dd')}T09:00:00`;
  return zonedTimeToUtc(businessStart, timezone);
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { attendees, searchRange, duration, preferences } = body;
    
    const timezone = preferences?.timezone || 'UTC';
    
    // Convert duration string to minutes
    const durationMap = {
      '15': 15,
      '30': 30,
      '60': 60
    };
    const durationMinutes = durationMap[duration] || 30; // Default to 30 if invalid

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get start time (9 AM next business day)
    const timeMin = getNextBusinessDayStart(timezone);

    // Calculate search end time based on range
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

    // Get free/busy information
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
      const slotEnd = addMinutes(currentTime, durationMinutes);
      
      const currentHour = parseInt(formatInTimeZone(currentTime, timezone, 'H'));
      const endHour = parseInt(formatInTimeZone(slotEnd, timezone, 'H'));

      // Skip if outside business hours
      if (currentHour < BUSINESS_START_HOUR || currentHour >= BUSINESS_END_HOUR || 
          endHour < BUSINESS_START_HOUR || endHour > BUSINESS_END_HOUR) {
        currentTime = setMinutes(setHours(addDays(startOfDay(currentTime), 1), BUSINESS_START_HOUR), 0);
        continue;
      }

      // Skip weekends
      if (isWeekend(currentTime)) {
        let daysToAdd = currentTime.getDay() === 6 ? 2 : 1;
        currentTime = setMinutes(setHours(addDays(startOfDay(currentTime), daysToAdd), BUSINESS_START_HOUR), 0);
        continue;
      }

      // Skip holidays
      if (isHoliday(currentTime)) {
        currentTime = setMinutes(setHours(addDays(startOfDay(currentTime), 1), BUSINESS_START_HOUR), 0);
        continue;
      }

      // Skip Fridays if specified in preferences
      if (preferences.noFridays && getDay(currentTime) === 5) {
        currentTime = setMinutes(setHours(addDays(startOfDay(currentTime), 3), BUSINESS_START_HOUR), 0);
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
          localTimes: [{
            dayOfWeek: formatInTimeZone(currentTime, timezone, 'EEEE'),
            localStart: formatAMPM(currentTime, timezone),
            localEnd: formatAMPM(slotEnd, timezone)
          }]
        });
      }

      // Move to next slot
      currentTime = addMinutes(currentTime, durationMinutes);
      
      // If we've passed business hours, move to next day
      const newHour = parseInt(formatInTimeZone(currentTime, timezone, 'H'));
      if (newHour >= BUSINESS_END_HOUR) {
        currentTime = setMinutes(setHours(addDays(startOfDay(currentTime), 1), BUSINESS_START_HOUR), 0);
      }
    }

    // Select a random quote
    const randomQuote = timeQuotes[Math.floor(Math.random() * timeQuotes.length)];

    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
        quote: randomQuote
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
