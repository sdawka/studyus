import type { CalendarProviderName, CalendarTokenBroker } from './types';

interface ClerkOauthAccessToken {
  token?: string;
  scopes?: string[];
}

interface ClerkTokenClient {
  users: {
    getUserOauthAccessToken(
      userId: string,
      provider: CalendarProviderName,
    ): Promise<{ data: ClerkOauthAccessToken[] }>;
  };
}

export type ProviderTokenUnavailableReason = 'missing_token' | 'missing_scopes';

export class ProviderTokenUnavailableError extends Error {
  readonly reason: ProviderTokenUnavailableReason;
  readonly provider: CalendarProviderName;

  constructor(provider: CalendarProviderName, reason: ProviderTokenUnavailableReason) {
    super(
      reason === 'missing_token'
        ? `No ${provider} OAuth access token is available`
        : `The ${provider} OAuth access token is missing required scopes`,
    );
    this.name = 'ProviderTokenUnavailableError';
    this.provider = provider;
    this.reason = reason;
  }
}

export function createClerkCalendarTokenBroker(client: ClerkTokenClient): CalendarTokenBroker {
  return {
    async getAccessToken(userId, provider, requiredScopes = []) {
      // Clerk attempts a refresh when this Backend API method is called. Do not
      // cache the returned provider token in the application.
      const response = await client.users.getUserOauthAccessToken(userId, provider);
      const tokens = response.data.filter(
        (entry): entry is ClerkOauthAccessToken & { token: string } => Boolean(entry.token),
      );
      if (!tokens.length) throw new ProviderTokenUnavailableError(provider, 'missing_token');

      const token = tokens.find((entry) => {
        const grantedScopes = new Set(entry.scopes ?? []);
        return requiredScopes.every((scope) => grantedScopes.has(scope));
      });
      if (!token) throw new ProviderTokenUnavailableError(provider, 'missing_scopes');
      return token.token;
    },
  };
}
