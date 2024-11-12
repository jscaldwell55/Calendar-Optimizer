import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import {
  addDays,
  addWeeks,
  addMonths,
  isWithinInterval,
  isWeekend,
  parseISO,
  format,
} from 'date-fns';

const BUSINESS_START_HOUR = 9;  // Local time
const BUSINESS_END_HOUR = 17;   // Local time
const MAX_SUGGESTIONS = 5;

// US Holidays 2024 (in CST/America/Chicago)
const US_HOLIDAYS_2024 = [
  '2024-01-01T06:00:00Z', // New Year's Day
  '2024-01-15T06:00:00Z', // Martin Luther King Jr. Day
  '2024-02-19T06:00:00Z', // Presidents' Day
  '2024-05-27T05:00:00Z', // Memorial Day
  '2024-07-04T05:00:00Z', // Independence Day
  '2024-09-02T05:00:00Z', // Labor Day
  '2024-10-14T05:00:00Z', // Columbus Day
  '2024-11-11T06:00:00Z', // Veterans Day
  '2024-11-28T06:00:00Z', // Thanksgiving Day
  '2024-12-25T06:00:00Z', // Christmas Day
];

const timeQuotes = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

// Helper function to convert UTC to local time string
function formatLocalTime(utcString, timezone) {
  return new Date(utcString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone
  });
}

// Helper function to get day of week in local timezone
function getLocalDayOfWeek(utcString, timezone) {
  return new Date(utcString).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: timezone
  });
}

// Helper to get UTC time for local business hours
function getBusinessHoursUTC(date, timezone, isStart = true) {
  const hour = isStart ? BUSINESS_START_HOUR : BUSINESS_END_HOUR;
  const localTime = new Date(date);
  localTime.setHours(hour, 0, 0, 0);
  return localTime.toISOString();
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
    
    const timezone = preferences?.timezone || 'America/Chicago';
    
    // Convert duration to minutes
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

    // Set up initial time range in UTC
    const now = new Date();
    let timeMin = getBusinessHoursUTC(now, timezone, true);
    
    // Calculate end time based on search range
    let timeMax;
    switch (searchRange) {
      case 'hour':
        timeMax = getBusinessHoursUTC(addDays(now, 1), timezone, false);
        break;
      case 'week':
        timeMax = getBusinessHoursUTC(addWeeks(now, 1), timezone, false);
        break;
      case 'month':
        timeMax = getBusinessHoursUTC(addMonths(now, 1), timezone, false);
        break;
      default:
        timeMax = getBusinessHoursUTC(addDays(now, 1), timezone, false);
    }

    // Set up free/busy query
    const freeBusyRequest = {
      timeMin,
      timeMax,
      timeZone: timezone,
      items: [
        { id: 'primary' },
        ...attendees.map(email => ({ id: email }))
      ]
    };

    console.log('Free/Busy Request:', freeBusyRequest);

    // Get free/busy information
    const freeBusy = await calendar.freebusy.query({
      requestBody: freeBusyRequest
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
    let currentTime = new Date(timeMin);
    const endTime = new Date(timeMax);

    while (availableSlots.length < MAX_SUGGESTIONS && currentTime < endTime) {
      const slotEnd = new Date(currentTime.getTime() + durationMinutes * 60000);
      
      // Convert to local time for checking business hours
      const localHour = new Date(currentTime).getHours();
      
      // Skip if outside business hours
      if (localHour < BUSINESS_START_HOUR || localHour >= BUSINESS_END_HOUR) {
        currentTime = new Date(currentTime.setHours(BUSINESS_START_HOUR, 0, 0, 0));
        currentTime = addDays(currentTime, 1);
        continue;
      }

      // Skip weekends
      if (isWeekend(currentTime)) {
        currentTime = addDays(currentTime, currentTime.getDay() === 6 ? 2 : 1);
        currentTime.setHours(BUSINESS_START_HOUR, 0, 0, 0);
        continue;
      }

      // Skip holidays
      if (US_HOLIDAYS_2024.includes(currentTime.toISOString())) {
        currentTime = addDays(currentTime, 1);
        currentTime.setHours(BUSINESS_START_HOUR, 0, 0, 0);
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && currentTime.getDay() === 5) {
        currentTime = addDays(currentTime, 3);
        currentTime.setHours(BUSINESS_START_HOUR, 0, 0, 0);
        continue;
      }

      // Check for conflicts
      const isSlotAvailable = !busyPeriods.some(period =>
        isWithinInterval(currentTime, { start: period.start, end: period.end }) ||
        isWithinInterval(slotEnd, { start: period.start, end: period.end })
      );

      if (isSlotAvailable) {
        const slotStartUTC = currentTime.toISOString();
        const slotEndUTC = slotEnd.toISOString();
        
        availableSlots.push({
          start: slotStartUTC,
          end: slotEndUTC,
          localTimes: [{
            dayOfWeek: getLocalDayOfWeek(slotStartUTC, timezone),
            localStart: formatLocalTime(slotStartUTC, timezone),
            localEnd: formatLocalTime(slotEndUTC, timezone)
          }]
        });
      }

      // Move to next slot
      currentTime = new Date(currentTime.getTime() + durationMinutes * 60000);
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
