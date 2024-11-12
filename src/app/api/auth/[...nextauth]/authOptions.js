import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

async function refreshAccessToken(token) {
  try {
    const url = `https://oauth2.googleapis.com/token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: token.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      console.error("Error refreshing token:", refreshedTokens);
      throw refreshedTokens;
    }

    console.log("Refreshed tokens:", refreshedTokens);
    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      idToken: refreshedTokens.id_token ?? token.idToken,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openidhttps://www.googleapis.com/auth/calendar.eventshttps://www.googleapis.com/auth/calendar.readonly',
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 10 * 60,    // 10 minutes in seconds
    updateAge: 5 * 60,  // 5 minutes in seconds
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = Date.now() + account.expires_in * 1000;
        token.idToken = account.id_token;
      }

      if (Date.now() < token.accessTokenExpires) {
        return token;
      }

      return await refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.idToken = token.idToken;
      session.userId = token.sub;
      return session;
    },
  },
};

export default authOptions;
