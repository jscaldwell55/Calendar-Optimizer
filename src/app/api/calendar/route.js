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
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const MAX_SUGGESTIONS = 5;

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
].map(date => date.toISOString());

const timeQuotes = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

// Helper function for 12-hour time format
function formatAMPM(isoString, timezone) {
  const date = utcToZonedTime(new Date(isoString), timezone);
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

// Helper to check if date is a holiday
function isHoliday(date, timezone) {
  const zonedDate = utcToZonedTime(date, timezone);
  return US_HOLIDAYS_2024.some(holiday => 
    isSameDay(zonedDate, utcToZonedTime(new Date(holiday), timezone))
  );
}

// Helper to get start of business day in user's timezone
function getBusinessDayStart(date, timezone) {
  const zonedDate = utcToZonedTime(date, timezone);
  const businessStart = setMinutes(setHours(startOfDay(zonedDate), BUSINESS_START_HOUR), 0);
  return zonedTimeToUtc(businessStart, timezone);
}

// Helper to get next available business day
function getNextBusinessDay(date, timezone) {
  let nextDay = utcToZonedTime(date, timezone);
  do {
    nextDay = addDays(nextDay, 1);
  } while (
    isWeekend(nextDay) || 
    isHoliday(zonedTimeToUtc(nextDay, timezone), timezone)
  );
  return zonedTimeToUtc(nextDay, timezone);
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
    const durationMinutes = durationMap[duration] || 30;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get current time in user's timezone
    const now = new Date();
    let timeMin = getBusinessDayStart(now, timezone);
    const currentHour = utcToZonedTime(now, timezone).getHours();

    // If current time is past business hours, move to next business day
    if (currentHour >= BUSINESS_END_HOUR) {
      timeMin = getBusinessDayStart(getNextBusinessDay(now, timezone), timezone);
    }

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
      
      // Convert to zoned time for checking hours
      const zonedTime = utcToZonedTime(currentTime, timezone);
      const zonedEndTime = utcToZonedTime(slotEnd, timezone);

      // Skip if outside business hours
      if (zonedTime.getHours() < BUSINESS_START_HOUR || 
          zonedTime.getHours() >= BUSINESS_END_HOUR ||
          zonedEndTime.getHours() > BUSINESS_END_HOUR) {
        currentTime = getBusinessDayStart(addDays(currentTime, 1), timezone);
        continue;
      }

      // Skip weekends
      if (isWeekend(zonedTime)) {
        const daysToAdd = zonedTime.getDay() === 6 ? 2 : 1;
        currentTime = getBusinessDayStart(addDays(currentTime, daysToAdd), timezone);
        continue;
      }

      // Skip holidays
      if (isHoliday(currentTime, timezone)) {
        currentTime = getBusinessDayStart(addDays(currentTime, 1), timezone);
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && zonedTime.getDay() === 5) {
        currentTime = getBusinessDayStart(addDays(currentTime, 3), timezone);
        continue;
      }

      // Check if slot conflicts with any busy periods
      const isSlotAvailable = !busyPeriods.some(busy =>
        isWithinInterval(currentTime, { start: busy.start, end: busy.end }) ||
        isWithinInterval(slotEnd, { start: busy.start, end: busy.end }) ||
        (currentTime <= busy.start && slotEnd >= busy.end)
      );

      if (isSlotAvailable) {
        const isoStart = currentTime.toISOString();
        const isoEnd = slotEnd.toISOString();
        availableSlots.push({
          start: isoStart,
          end: isoEnd,
          localTimes: [{
            dayOfWeek: format(zonedTime, 'EEEE'),
            localStart: formatAMPM(isoStart, timezone),
            localEnd: formatAMPM(isoEnd, timezone)
          }]
        });
      }

      // Move to next slot
      currentTime = addMinutes(currentTime, durationMinutes);
      
      // If we've passed business hours, move to next business day
      const nextSlotHour = utcToZonedTime(currentTime, timezone).getHours();
      if (nextSlotHour >= BUSINESS_END_HOUR) {
        currentTime = getBusinessDayStart(addDays(currentTime, 1), timezone);
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
