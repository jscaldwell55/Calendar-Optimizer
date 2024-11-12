'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Poetry collection
const poetryLines = [
  "Tell me, what is it you plan to do with your one wild and precious life?",
  "For every thing there is a season, and a time to every purpose under heaven.",
  "The world is too much with us; late and soon, Getting and spending, we lay waste our powers.",
  "I have spread my dreams under your feet; Tread softly because you tread on my dreams.",
  "Hope is the thing with feathers that perches in the soul, And sings the tune without the words, and never stops at all.",
];

export default function MeetingScheduler() {
  const { data: session, status } = useSession();
  const [attendees, setAttendees] = useState([]);
  const [newAttendee, setNewAttendee] = useState('');
  const [searchRange, setSearchRange] = useState('week'); // Default to "week"
  const [duration, setDuration] = useState('30'); // Default to 30 minutes
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);
  const [poetryLine, setPoetryLine] = useState(poetryLines[Math.floor(Math.random() * poetryLines.length)]);

  const handleAttendeeInput = (e) => {
    setNewAttendee(e.target.value);
  };

  const addAttendees = () => {
    if (newAttendee.trim()) {
      // Split by spaces, commas, or semicolons, and remove any empty strings
      const emails = newAttendee.split(/[\s,;]+/).filter(email => email);
      setAttendees([...attendees, ...emails]);
      setNewAttendee('');
    }
  };

  const findTimes = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/meetings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attendees,
          searchRange,
          duration,
          preferences: {
            noFridays: false
          },
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone // Move timezone to top level
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch meeting times');
      }

      const data = await response.json();
      setSuggestions(data.suggestions);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <Card className="w-full max-w-2xl mx-auto mt-20 p-10">
        <CardContent className="flex justify-center text-2xl font-semibold">Loading...</CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="w-full max-w-2xl mx-auto mt-20 p-10 shadow-lg rounded-lg">
        <CardContent className="flex flex-col items-center gap-6">
          <p className="text-center text-xl mb-4">
            Sign in with Google to access your calendar
          </p>
          <Button 
            onClick={() => signIn('google')}
            className="bg-blue-500 hover:bg-blue-600 px-8 py-4 text-lg"
          >
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-3xl mx-auto mt-20 p-10 shadow-lg rounded-lg border border-gray-200">
      <CardHeader className="text-center mb-8">
        <CardTitle className="text-4xl font-bold">Find Meeting Times <span className="text-xl">by Jay</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-10">
        {/* Time Range Selection */}
        <div className="flex items-center gap-4">
          <label htmlFor="searchRange" className="text-lg font-medium">
            Available in the:
          </label>
          <select
            id="searchRange"
            value={searchRange}
            onChange={(e) => setSearchRange(e.target.value)}
            className="w-[180px] px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="day">Next Day</option>
            <option value="week">Next Week</option>
            <option value="month">Next Month</option>
          </select>
        </div>

        {/* Duration Selection */}
        <div className="flex items-center gap-4">
          <label htmlFor="duration" className="text-lg font-medium">
            Duration:
          </label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-[180px] px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
          </select>
        </div>

        {/* Attendee Input */}
        <div className="flex items-center gap-4">
          <Input
            type="text"
            value={newAttendee}
            onChange={handleAttendeeInput}
            onKeyPress={(e) => {
              if (e.key === 'Enter') addAttendees();
            }}
            placeholder="Add attendee emails"
            className="flex-1 text-lg px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button
            onClick={addAttendees}
            disabled={!newAttendee.trim()}
            className="px-6 py-2 text-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-md"
          >
            Add
          </Button>
        </div>

        {/* Attendee List */}
        <div className="flex flex-wrap gap-3">
          {attendees.map((email, index) => (
            <div key={index} className="flex items-center bg-blue-50 rounded-full px-4 py-2 text-lg border border-blue-200">
              <span>{email}</span>
              <button
                onClick={() => setAttendees(attendees.filter((_, i) => i !== index))}
                className="ml-2 text-red-500 hover:text-red-700 font-semibold"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Find Times Button */}
        <div className="text-center">
          <Button
            onClick={findTimes}
            disabled={isLoading || !attendees.length}
            className="w-full bg-blue-500 hover:bg-blue-600 px-8 py-3 text-lg font-semibold text-white rounded-lg shadow-lg"
          >
            {isLoading ? 'Finding available times...' : 'Find Meeting Times'}
          </Button>
        </div>

        {/* Meeting Suggestions */}
        {suggestions && suggestions.length > 0 && (
          <div className="space-y-6 mt-10">
            {suggestions.map((suggestion, i) => (
              <div 
                key={i}
                className="p-6 border-2 border-gray-100 rounded-lg bg-white hover:bg-blue-50 cursor-pointer transition-all duration-200 hover:shadow-lg text-lg shadow"  
              >
                <div className="font-semibold text-blue-600">
                  {suggestion.localTimes[0].dayOfWeek}  
                </div>
                <div className="text-2xl font-medium mt-1">
                  {suggestion.localTimes[0].localStart} - {suggestion.localTimes[0].localEnd}
                </div>
              </div>
            ))}
            
            {/* Poetry Display */}
            {poetryLine && (
              <div className="mt-10 pt-10 border-t">
                <p className="text-gray-600 text-center font-serif text-2xl italic leading-relaxed tracking-wide">
                  "{poetryLine}"
                </p>
                <div className="mt-4 w-16 h-0.5 bg-gray-200 mx-auto"></div>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="text-red-500 text-center p-6 bg-red-50 rounded-lg mt-6 text-lg border-2 border-red-100">
            {error}
          </div>  
        )}

        {/* No Results Message */} 
        {suggestions && !suggestions.length && (
          <div className="text-center text-gray-500 p-6 bg-gray-50 rounded-lg mt-6 text-lg border-2 border-gray-100">
            No available times found. Try a different time range.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
