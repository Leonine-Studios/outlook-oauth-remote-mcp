/**
 * People tools for Microsoft Graph API
 */

import { z } from 'zod';
import { graphRequest, handleGraphResponse, formatErrorResponse } from '../graph/client.js';
import { serializeResponse } from '../utils/tonl.js';

// ============================================================================
// Schemas
// ============================================================================

const lookupContactEmailSchema = z.object({
  query: z.string().min(1),
  top: z.number().min(1).max(20).optional().default(10),
});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Lookup contact email addresses by name using Microsoft Graph People API
 * Returns only email addresses with relevance ranking
 */
async function lookupContactEmail(params: Record<string, unknown>) {
  const { query, top } = lookupContactEmailSchema.parse(params);
  
  try {
    const queryParams = new URLSearchParams();
    queryParams.set('$search', `"${query}"`);
    queryParams.set('$top', String(top));
    queryParams.set('$select', 'displayName,scoredEmailAddresses');
    
    const url = `/me/people?${queryParams.toString()}`;
    const response = await graphRequest<{ value: unknown[] }>(url);
    
    if (!response.ok) {
      return handleGraphResponse(response);
    }
    
    // Extract and format results
    const people = (response.data as { value: unknown[] })?.value || [];
    const results = people
      .map((person: unknown) => {
        const p = person as {
          displayName?: string;
          scoredEmailAddresses?: Array<{
            address?: string;
            relevanceScore?: number;
          }>;
        };
        
        const scoredEmails = p.scoredEmailAddresses || [];
        if (scoredEmails.length === 0) return null;
        
        // Take the highest-scored email (first one)
        const primaryEmail = scoredEmails[0];
        if (!primaryEmail.address) return null;
        
        return {
          email: primaryEmail.address,
          displayName: p.displayName || primaryEmail.address,
          relevanceScore: primaryEmail.relevanceScore || 0,
        };
      })
      .filter((r): r is { email: string; displayName: string; relevanceScore: number } => r !== null);
    
    return {
      content: [{
        type: 'text' as const,
        text: serializeResponse(results),
      }],
    };
  } catch (error) {
    return formatErrorResponse(error);
  }
}

// ============================================================================
// Tool Definitions for MCP
// ============================================================================

export const peopleToolDefinitions = [
  {
    name: 'lookup-contact-email',
    description: `Find email addresses by person name. Returns contacts ranked by communication frequency.

Use this to find someone's email when you only have their name. More reliable than search-mail for contact lookup.

Returns: Array of {email, displayName, relevanceScore}.`,
    readOnly: true,
    requiredScopes: ['People.Read'],
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Person name or partial name to search for',
        },
        top: {
          type: 'number',
          description: 'Maximum number of contacts to return (1-20, default: 10)',
        },
      },
      required: ['query'],
    },
    handler: lookupContactEmail,
  },
];
