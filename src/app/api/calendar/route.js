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
  startOfDay,
} from 'date-fns';

const BUSINESS_START_HOUR = 9;  // 9 AM Local time
const BUSINESS_END_HOUR = 17;   // 5 PM Local time
const MAX_SUGGESTIONS = 5;

// Helper to get UTC hours offset for a timezone
function getTimezoneOffset(timezone) {
  const date = new Date();
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (tzDate - utcDate) / (60 * 60 * 1000);
}

// Helper to convert local hour to UTC
function localToUTCHour(localHour, timezone) {
  const offset = getTimezoneOffset(timezone);
  return (localHour - offset) % 24;
}

// Helper to get start of business day in UTC
function getBusinessDayStart(date, timezone) {
  const localDate = startOfDay(date);
  const utcHour = localToUTCHour(BUSINESS_START_HOUR, timezone);
  localDate.setUTCHours(utcHour, 0, 0, 0);
  return localDate;
}

// Helper function to format time in 12-hour format
function formatTime(date, timezone) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone
  });
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

    // Calculate UTC hours for business hours
    const startHourUTC = localToUTCHour(BUSINESS_START_HOUR, timezone);
    const endHourUTC = localToUTCHour(BUSINESS_END_HOUR, timezone);

    // Set up initial time range
    const now = new Date();
    let timeMin = getBusinessDayStart(now, timezone);

    // Move to next day if current time is past business hours
    const currentLocalHour = now.getHours();
    if (currentLocalHour >= BUSINESS_END_HOUR) {
      timeMin = getBusinessDayStart(addDays(now, 1), timezone);
    }

    // Calculate end time based on search range
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

    // Set up free/busy query
    const freeBusyRequest = {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: timezone,
      items: [
        { id: 'primary' },
        ...attendees.map(email => ({ id: email }))
      ]
    };

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
    let currentTime = timeMin;

    while (availableSlots.length < MAX_SUGGESTIONS && currentTime < timeMax) {
      const slotEnd = new Date(currentTime.getTime() + durationMinutes * 60000);

      // Get local hour for the current time
      const localHour = new Date(currentTime).toLocaleString('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: timezone
      });

      // Skip if outside business hours
      if (localHour < BUSINESS_START_HOUR || localHour >= BUSINESS_END_HOUR) {
        currentTime = new Date(currentTime.setUTCHours(startHourUTC, 0, 0, 0));
        currentTime = addDays(currentTime, 1);
        continue;
      }

      // Skip weekends
      if (isWeekend(currentTime)) {
        currentTime = addDays(currentTime, currentTime.getDay() === 6 ? 2 : 1);
        currentTime.setUTCHours(startHourUTC, 0, 0, 0);
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && currentTime.getDay() === 5) {
        currentTime = addDays(currentTime, 3);
        currentTime.setUTCHours(startHourUTC, 0, 0, 0);
        continue;
      }

      // Check for conflicts
      const isSlotAvailable = !busyPeriods.some(period =>
        isWithinInterval(currentTime, { start: period.start, end: period.end }) ||
        isWithinInterval(slotEnd, { start: period.start, end: period.end })
      );

      if (isSlotAvailable) {
        availableSlots.push({
          start: currentTime.toISOString(),
          end: slotEnd.toISOString(),
          localTimes: [{
            dayOfWeek: currentTime.toLocaleDateString('en-US', {
              weekday: 'long',
              timeZone: timezone
            }),
            localStart: formatTime(currentTime, timezone),
            localEnd: formatTime(slotEnd, timezone)
          }]
        });
      }

      // Move to next slot
      currentTime = new Date(currentTime.getTime() + durationMinutes * 60000);
    }

    return new Response(
      JSON.stringify({
        suggestions: availableSlots,
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
