import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addHours, addMonths, parseISO, isWithinInterval } from 'date-fns';

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
      case 'hour':
        timeMax = addHours(timeMin, 1);
        break;
      case 'week':
        timeMax = addDays(timeMin, 7);
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
          timeZone: preferences.timezone || 'America/New_York',
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

        // Skip non-working hours
       const hours = slotStart.getHours();
if (hours >= 17 || hours < 9) continue;

        // Skip weekends
        const day = slotStart.getDay();
        if (day === 0 || day === 6) continue;

        // Skip Fridays if excluded
        if (preferences.noFridays && day === 5) continue;

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

      return new Response(
        JSON.stringify({
          suggestions: availableSlots,
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
