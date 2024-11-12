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
  parseISO,
  format,
} from 'date-fns';

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;
const MAX_SUGGESTIONS = 5;

// US Holidays 2024
const US_HOLIDAYS_2024 = [
  '2024-01-01', // New Year's Day
  '2024-01-15', // Martin Luther King Jr. Day
  '2024-02-19', // Presidents' Day
  '2024-05-27', // Memorial Day
  '2024-07-04', // Independence Day
  '2024-09-02', // Labor Day
  '2024-10-14', // Columbus Day
  '2024-11-11', // Veterans Day
  '2024-11-28', // Thanksgiving Day
  '2024-12-25', // Christmas Day
];

const timeQuotes = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

// Helper function for 12-hour time format
function formatAMPM(dateString) {
  const date = new Date(dateString);
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

// Helper to check if date is a holiday
function isHoliday(dateString) {
  const date = new Date(dateString);
  return US_HOLIDAYS_2024.some(holiday => 
    isSameDay(date, new Date(holiday))
  );
}

// Helper to get next business day's date string
function getNextBusinessDay(dateString, timezone) {
  let date = new Date(dateString);
  do {
    date = addDays(date, 1);
  } while (
    isWeekend(date) || 
    isHoliday(date.toISOString())
  );
  
  return format(date, "yyyy-MM-dd'T'09:00:00");
}

// Helper to batch process attendee calendars
async function getBatchFreeBusy(calendar, timeMin, timeMax, attendees, timezone) {
  const batchSize = 10;
  const batches = [];
  
  for (let i = 0; i < attendees.length; i += batchSize) {
    batches.push(attendees.slice(i, i + batchSize));
  }

  const allBusyPeriods = [];
  
  for (const batch of batches) {
    try {
      const freeBusy = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          timeZone: timezone,
          items: batch.map(email => ({ id: email }))
        },
      });

      const batchBusyPeriods = Object.values(freeBusy.data.calendars)
        .flatMap(calendar => calendar.busy || []);

      allBusyPeriods.push(...batchBusyPeriods);
    } catch (error) {
      console.error(`Error processing batch: ${batch.join(', ')}`, error);
    }
  }

  return allBusyPeriods;
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
    
    const timezone = preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    
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

    // Get current date in correct format
    const now = new Date();
    const currentHour = now.getHours();
    
    // Set up initial search time
    let startDate = format(now, "yyyy-MM-dd'T'09:00:00");
    if (currentHour >= BUSINESS_END_HOUR) {
      startDate = getNextBusinessDay(now.toISOString(), timezone);
    }

    // Calculate end date based on search range
    let endDate;
    switch (searchRange) {
      case 'hour':
        endDate = format(addDays(parseISO(startDate), 1), "yyyy-MM-dd'T'17:00:00");
        break;
      case 'week':
        endDate = format(addWeeks(parseISO(startDate), 1), "yyyy-MM-dd'T'17:00:00");
        break;
      case 'month':
        endDate = format(addMonths(parseISO(startDate), 1), "yyyy-MM-dd'T'17:00:00");
        break;
      default:
        endDate = format(addDays(parseISO(startDate), 1), "yyyy-MM-dd'T'17:00:00");
    }

    // Get free/busy information
    const freeBusyRequest = {
      timeMin: startDate,
      timeMax: endDate,
      timeZone: timezone,
      items: [
        { id: 'primary' },
        ...attendees.map(email => ({ id: email }))
      ]
    };

    const busyPeriods = await getBatchFreeBusy(
      calendar, 
      startDate, 
      endDate, 
      [...attendees, 'primary'],
      timezone
    );

    // Find available slots
    const availableSlots = [];
    let currentTime = new Date(startDate);
    const endTime = new Date(endDate);

    while (availableSlots.length < MAX_SUGGESTIONS && currentTime < endTime) {
      const slotEndTime = new Date(currentTime.getTime() + durationMinutes * 60000);
      
      // Skip if outside business hours
      const hour = currentTime.getHours();
      if (hour < BUSINESS_START_HOUR || hour >= BUSINESS_END_HOUR) {
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
      if (isHoliday(currentTime.toISOString())) {
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
        isWithinInterval(currentTime, { start: new Date(period.start), end: new Date(period.end) }) ||
        isWithinInterval(slotEndTime, { start: new Date(period.start), end: new Date(period.end) })
      );

      if (isSlotAvailable) {
        const timeSlot = {
          start: currentTime.toISOString(),
          end: slotEndTime.toISOString(),
          localTimes: [{
            dayOfWeek: format(currentTime, 'EEEE'),
            localStart: formatAMPM(currentTime),
            localEnd: formatAMPM(slotEndTime)
          }]
        };
        availableSlots.push(timeSlot);
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
