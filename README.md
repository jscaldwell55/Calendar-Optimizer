# Calendar Optimizer

## Features
- Sign in with Google
- Paste multiple Gmail or Google Workspace addresses
- Choose availability search period (1 day, 1 week, 1 month)
- Set meeting duration (15 min, 30 min, 1 hour) 
- Optional: Exclude Fridays
- Get up to 5 available meeting times
- Signs out from Google automatically after 10 minutes of inactivity

- **Optimizations**: 
- Only checks 9 AM - 5 PM
- Skips weekends
- Skips major US holidays 2024
- Works with pasted lists of emails
- Multiple email separator support (commas, spaces, newlines)

## Requirements

- Google Account (works with both @gmail.com and Google Workspace domains)
- Calendar access permission

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
3. Select search range (Day/Week/Month)
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
- Server-side rendering 

## Deployment

Hosted on Vercel 

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
