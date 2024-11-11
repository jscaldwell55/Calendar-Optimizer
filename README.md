# Calendar Optimizer

## Features

- **Smart Scheduling**: Find available meeting times across multiple attendees
- **Time Ranges**: Search next hour, week, or month
- **Meeting Duration**: Choose between 15, 30, or 60-minute meetings
- **Optimizations**: 
  - Business hours only (9 AM - 5 PM)
  - Weekend-free scheduling
  - Optional Friday exclusion
  - US holidays automatically blocked
- **Results**: Shows up to 5 best available time slots
- **Have some culture with your availabilites**: Each search includes a randomly selected literary quote (mostly)

## Requirements

- Google Account (works with both @gmail.com and Google Workspace domains)
- Calendar access permission
- Modern web browser

## Time Slot Logic

The app automatically filters out:
- Weekend slots
- Major US holidays
- Non-business hours
- Times when any attendee is busy
- Fridays (if option selected)

## Usage

1. Sign in with your Google account
2. Enter attendee email addresses (supports multiple formats):
   - Comma-separated
   - Space-separated
   - New line-separated
3. Select search range (Hour/Week/Month)
4. Choose meeting duration
5. Optionally exclude Fridays
6. Click "Find Available Times"

## Privacy & Security

- Uses Google OAuth for secure authentication
- Only accesses calendar availability information
- No meeting details or private information is stored

## Technical Details

- Built with Next.js
- Google Calendar API integration
- NextAuth.js for authentication
- Server-side rendering for optimal performance

## Limitations

- Maximum of 5 time slots returned
- Google Calendar only
- Business hours (9 AM - 5 PM) only
- Future availability only

## Deployment

Hosted on Vercel for reliable access and performance.

## Local Development

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

Required environment variables:
```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_generated_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```
