'use client';

import { useSession, signIn } from 'next-auth/react';
import { useState } from 'react';

const POEMS = [
  "Go, sir, gallop and don’t forget that the world was made in six days. You can ask me for anything but not time. - Napoleon ",
  "I love you when you call me to admire, A jet's pink trail above the sunset fire. - Vladimir Nabokov",
  "The King was not mad; he was just an eccentric living in a world of dreams. - said about Ludwig II of Bavaria by his cousin, Elizabeth of Autria",
  "And as I sat there, brooding on the old, unknown world, I thought of Gatsby’s wonder when he first picked out the green light at the end of Daisy’s dock. - F Scott Fitzgerald.",
  "I dare do all that may become a man; who dares do more is none. - Shakespeare ",
  "I should like to bury something precious in every place where I've been happy and then, when I'm old and ugly and miserable, I could come back and dig it up and remember. - Evelyn Waugh",
  "Mortal as I am, I know that I am born for a day. But when I follow at my pleasure the serried multitude of the stars in their circular course, my feet no longer touch the earth. - Ptolemy",
  "If you are lucky enough to have lived in Paris as a young man, then wherever you go for the rest of your life, it stays with you, for Paris is a moveable feast. - Ernest Hemingway",
  "A middleman’s business is to make himself a necessary evil. - William Gibson",
  "Some work of noble note, may yet be done, not unbecoming men that strove with Gods. - Tennyson.",
  "No. I'm in touch with humanity. - Patrick Bateman",
];

export default function Home() {
  const { data: session, status } = useSession();
  const [attendees, setAttendees] = useState('');
  const [searchRange, setSearchRange] = useState('week');
  const [duration, setDuration] = useState('30');
  const [noFridays, setNoFridays] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [randomPoem, setRandomPoem] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('Starting handleSubmit with:', {
        attendees,
        searchRange,
        duration,
        noFridays
      });

      const emailList = attendees
        .split(/[,;\s\n]+/)
        .map(email => email.trim())
        .filter(email => email.length > 0);

      console.log('Processed email list:', emailList);

      if (emailList.length === 0) {
        setError('Please enter at least one email address');
        setLoading(false);
        return;
      }

      const requestBody = {
        attendees: emailList,
        searchRange,
        duration: parseInt(duration),
        preferences: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          noFridays,
          workingHours: {
            start: 9,
            end: 17,
          }
        }
      };

      console.log('Sending request with body:', requestBody);

      const response = await fetch('/api/calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', response.status);

      const rawResponse = await response.text();
      console.log('Raw response:', rawResponse);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, body: ${rawResponse}`);
      }

      let data;
      try {
        data = JSON.parse(rawResponse);
      } catch (e) {
        console.error('Error parsing response:', e);
        throw new Error('Invalid response format from server');
      }

      console.log('Processed response data:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      setResults(data.suggestions);
      setRandomPoem(POEMS[Math.floor(Math.random() * POEMS.length)]);
      setError('');
    } catch (error) {
      console.error('Main error:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      setError(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="p-8 bg-white rounded-lg shadow-lg">
          <h1 className="text-3xl font-bold mb-6 text-center">Calendar Scheduler</h1>
          <button
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="w-full bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="mb-12">
            <h1 className="text-3xl font-bold">
              Schedule Meetings{' '}
              <span className="text-lg font-normal">with Jay</span>
            </h1>
            <p className="mt-2 text-gray-600">
              Signed in as: {session.user.email}
            </p>
          </div>

          <div className="space-y-8">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Attendees' Emails
              </label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                rows="3"
                placeholder="Paste email addresses (separated by commas, spaces, or new lines)"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Available Times For
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  value={searchRange}
                  onChange={(e) => setSearchRange(e.target.value)}
                >
                  <option value="day">1 Day</option>
                  <option value="week">1 Week</option>
                  <option value="month">1 Month</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Duration
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                >
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                </select>
              </div>
            </div>

            <div className="flex items-center py-2">
              <input
                type="checkbox"
                id="noFridays"
                checked={noFridays}
                onChange={(e) => setNoFridays(e.target.checked)}
                className="h-4 w-4 text-blue-500 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="noFridays" className="ml-2 text-sm text-gray-700">
                Exclude Fridays
              </label>
            </div>

            <button
              className="w-full bg-blue-500 text-white px-4 py-3 rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
              onClick={handleSubmit}
              disabled={loading || !attendees.trim()}
            >
              {loading ? 'Finding Times...' : 'Find Available Times'}
            </button>
          </div>

          {results && (
            <div className="mt-12 space-y-6">
              <h2 className="text-xl font-semibold">Available Times:</h2>
              {results.length > 0 ? (
                <div className="space-y-3">
                  {results.map((slot, index) => (
                    <div key={index} className="p-4 bg-gray-50 rounded-md">
                      {new Date(slot.start).toLocaleDateString()} at{' '}
                      {new Date(slot.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} -{' '}
                      {new Date(slot.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600">No available times found. Try different parameters.</p>
              )}
              {randomPoem && (
                <div className="mt-8 p-4 bg-gray-50 rounded-md italic text-gray-600 text-center">
                  {randomPoem}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
