import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addHours, addMonths, parseISO, isWithinInterval, isWeekend, getDay, isSameDay } from 'date-fns';

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

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      access_token: session.accessToken,
      refresh_token: session.refreshToken
    });

    // Create calendar client
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Set time range
    const timeMin = new Date();
    let timeMax;
    switch (searchRange) {
      case 'day':
        timeMax = addDay(timeMin, 1);
        break;
      case 'week':
        timeMax = addWeek(timeMin, 1);
        break;
      case 'month':
        timeMax = addMonths(timeMin, 1);
        break;
      default:
        timeMax = addDays(timeMin, 1);
    }

    try {
      const freeBusy = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: [
            { id: 'primary' },
            ...attendees.map(email => ({ id: email }))
          ],
          timeZone: preferences.timezone || 'system',
        },
      });

      console.log('FreeBusy response:', JSON.stringify(freeBusy.data, null, 2));

      const busyPeriods = Object.values(freeBusy.data.calendars)
        .flatMap(calendar => calendar.busy || [])
        .map(period => ({
          start: new Date(period.start),
          end: new Date(period.end)
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

 // Find available slots
const availableSlots = [];
const slotDuration = duration * 60 * 1000;
const stepSize = 30 * 60 * 1000;

for (
  let currentTime = timeMin.getTime();
  currentTime < timeMax.getTime() && availableSlots.length < 5;
  currentTime += stepSize
) {
  const slotStart = new Date(currentTime);
  const slotEnd = new Date(currentTime + slotDuration);

  // Check if the slot falls within business hours (9 AM - 5 PM)
  const slotStartHours = slotStart.getHours();
  const slotStartMinutes = slotStart.getMinutes();
  const slotEndHours = slotEnd.getHours();
  const slotEndMinutes = slotEnd.getMinutes();

  if (
    slotStartHours < 9 || 
    (slotStartHours === 9 && slotStartMinutes < 0) ||
    slotEndHours > 17 ||
    (slotEndHours === 17 && slotEndMinutes > 0)
  ) {
    continue;
  }

  // Check if the slot falls on a weekend
  if (isWeekend(slotStart)) continue;

  // Check if the slot falls on a US holiday in 2024
  if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) continue;

  // Check if the slot falls on a Friday and Fridays are excluded
  if (preferences.noFridays && getDay(slotStart) === 5) continue;

        const isAvailable = !busyPeriods.some(busy =>
          isWithinInterval(slotStart, { start: busy.start, end: busy.end }) ||
          isWithinInterval(slotEnd, { start: busy.start, end: busy.end }) ||
          (slotStart <= busy.start && slotEnd >= busy.end)
        );

        if (isAvailable) {
          availableSlots.push({
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
      }

      // Get a random time-themed quote
      const timeQuotes = [
        "Time is the most valuable thing a man can spend. - Theophrastus",
        "Time is what we want most, but what we use worst. - William Penn",
        "The future is something which everyone reaches at the rate of sixty minutes an hour, whatever he does, whoever he is. - C.S. Lewis",
        // Add more time-themed quotes
      ];
      const randomQuote = timeQuotes[Math.floor(Math.random() * timeQuotes.length)];

      return new Response(
        JSON.stringify({
          suggestions: availableSlots,
          quote: randomQuote,
          metadata: {
            searchRange,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    } catch (calendarError) {
      console.error('Calendar API error:', calendarError);
      return new Response(
        JSON.stringify({
          error: 'Calendar API error',
          details: calendarError.message
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
