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
import { formatInTimeZone } from 'date-fns-tz';

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const MAX_SUGGESTIONS = 10;

// Poetry collection
const poetryLines = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

// Helper to check if a date is within business hours
function isWithinBusinessHours(date) {
  const hours = date.getHours();
  return hours >= BUSINESS_START_HOUR && hours < BUSINESS_END_HOUR;
}

// Helper to get next valid business day start
function getNextBusinessDayStart(date) {
  let nextDay = startOfDay(date);
  
  if (date.getHours() >= BUSINESS_END_HOUR) {
    nextDay = addDays(nextDay, 1);
  }
  
  while (isWeekend(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }
  
  return setMinutes(setHours(nextDay, BUSINESS_START_HOUR), 0);
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
    
    // Get timezone from preferences
    const timezone = preferences?.timezone || 'UTC';

    // Convert duration to minutes
    const durationMinutes = parseInt(duration, 10);

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

      // Skip if slot is outside business hours
      if (!isWithinBusinessHours(currentTime)) {
        currentTime = getNextBusinessDayStart(addDays(currentTime, 1));
        continue;
      }

      // Skip weekends
      if (isWeekend(currentTime)) {
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
          localTimes: [{
            dayOfWeek: formatInTimeZone(currentTime, timezone, 'EEEE'),
            localStart: formatInTimeZone(currentTime, timezone, 'h:mm a'),
            localEnd: formatInTimeZone(slotEnd, timezone, 'h:mm a')
          }]
        });
      }

      // Move to next slot
      currentTime = addMinutes(currentTime, 30);
    }

    // Select a random poetry line
    const randomPoetry = poetryLines[Math.floor(Math.random() * poetryLines.length)];

    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
        poetry: randomPoetry
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
