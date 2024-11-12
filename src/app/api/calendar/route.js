import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import { addDays, addWeeks, addMonths, isWeekend, getDay, isSameDay, startOfDay, endOfDay } from 'date-fns';

// ... (holidays array stays the same)

export async function POST(req) {
  try {
    // ... (session validation and OAuth2 setup stays the same)

    const body = await req.json();
    const { attendees, searchRange, duration, preferences } = body;
    
    // Start from the next 30-minute increment
    const now = new Date();
    const currentMinutes = now.getMinutes();
    const nextSlotMinutes = Math.ceil(currentMinutes / 30) * 30;
    const timeMin = new Date(now);
    timeMin.setMinutes(nextSlotMinutes);
    timeMin.setSeconds(0);
    timeMin.setMilliseconds(0);

    // If we're past 5 PM or before 9 AM, start from 9 AM next business day
    if (timeMin.getHours() >= 17 || timeMin.getHours() < 9) {
      timeMin.setDate(timeMin.getDate() + 1);
      timeMin.setHours(9);
      timeMin.setMinutes(0);
    }

    let timeMax;
    switch (searchRange) {
      case 'day':
        timeMax = addDays(startOfDay(new Date(timeMin)), 1);
        break;
      case 'week':
        timeMax = addWeeks(startOfDay(new Date(timeMin)), 1);
        break;
      case 'month':
        timeMax = addMonths(startOfDay(new Date(timeMin)), 1);
        break;
      default:
        timeMax = addDays(startOfDay(new Date(timeMin)), 1);
    }

    // First, get all-day events
    const eventsResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay(timeMin).toISOString(),
      timeMax: endOfDay(timeMax).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const allDayEvents = eventsResponse.data.items
      .filter(event => {
        const start = new Date(event.start.date || event.start.dateTime);
        return !event.start.dateTime; // true if it's an all-day event
      })
      .map(event => ({
        start: new Date(event.start.date),
        end: new Date(event.end.date)
      }));

    // Then get free/busy information
    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [
          { id: 'primary' },
          ...attendees.map(email => ({ id: email }))
        ],
        timeZone: 'system',
      },
    });

    const busyPeriods = Object.values(freeBusy.data.calendars)
      .flatMap(calendar => calendar.busy || [])
      .map(period => ({
        start: new Date(period.start),
        end: new Date(period.end)
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const availableSlots = [];
    const slotDuration = duration * 60 * 1000;
    const stepSize = 30 * 60 * 1000;

    for (
      let currentTime = timeMin.getTime();
      currentTime < timeMax.getTime() && availableSlots.length < 10;
      currentTime += stepSize
    ) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime + slotDuration);

      // Skip times outside 9 AM - 5 PM
      const hour = slotStart.getHours();
      if (hour < 9 || hour >= 17) {
        continue;
      }

      // Skip if slot ends after 5 PM
      if (slotEnd.getHours() >= 17) {
        continue;
      }

      // Skip weekends
      if (isWeekend(slotStart)) {
        continue;
      }

      // Skip holidays
      if (usHolidays2024.some(holiday => isSameDay(slotStart, holiday))) {
        continue;
      }

      // Skip Fridays if specified
      if (preferences.noFridays && getDay(slotStart) === 5) {
        continue;
      }

      // Skip all-day events
      const isAllDayEvent = allDayEvents.some(event => {
        const eventStart = startOfDay(event.start);
        const eventEnd = endOfDay(event.end);
        return slotStart >= eventStart && slotStart < eventEnd;
      });

      if (isAllDayEvent) {
        continue;
      }

      // Check against busy periods
      const isAvailable = !busyPeriods.some(busy => (
        (slotStart >= busy.start && slotStart < busy.end) ||
        (slotEnd > busy.start && slotEnd <= busy.end) ||
        (slotStart <= busy.start && slotEnd >= busy.end)
      ));

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
          timezone: 'system'
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

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
