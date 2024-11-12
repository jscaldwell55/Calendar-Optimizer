'use client';

import { useSession, signIn } from 'next-auth/react';
import { useState } from 'react';
import SignOutButton from '../components/SignOutButton';  // Add this import

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

  // ... rest of your state and handleSubmit function stays exactly the same ...

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
            <div className="mt-2 flex items-center justify-between">
              <p className="text-gray-600">
                Signed in as: {session.user.email}
              </p>
              <SignOutButton />
            </div>
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
                onChange={(e) => setNoFridays(e.checked)}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
