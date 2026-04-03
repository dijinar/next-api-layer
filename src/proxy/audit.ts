/**
 * Audit Logging
 * 
 * Event-based security audit logging system.
 * Emits events for authentication, access control, and security violations.
 */

import { NextRequest } from 'next/server';
import type { ResolvedAuditConfig, AuditEvent, AuditEventType } from '../shared/types';

/**
 * Creates an audit logger instance
 */
export function createAuditLogger(config: ResolvedAuditConfig) {
  /**
   * Check if event type is enabled
   */
  function isEnabled(type: AuditEventType): boolean {
    return config.enabled && config.events.includes(type);
  }

  /**
   * Extract IP address from request
   */
  function getIp(req: NextRequest): string | null {
    return (
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    );
  }

  /**
   * Emit an audit event
   */
  async function emit(
    type: AuditEventType,
    req: NextRequest,
    options: {
      success: boolean;
      userId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!isEnabled(type)) {
      return;
    }

    const event: AuditEvent = {
      type,
      timestamp: new Date(),
      ip: getIp(req),
      userId: options.userId,
      path: req.nextUrl.pathname,
      method: req.method,
      success: options.success,
      metadata: options.metadata,
    };

    // Call user's logger
    if (config.logger) {
      try {
        await config.logger(event);
      } catch (error) {
        // Silently fail - don't break the request flow for logging errors
        console.error('[next-api-layer] Audit logger error:', error);
      }
    }
  }

  // ==================== Convenience Methods ====================

  /**
   * Log successful authentication
   */
  function authSuccess(req: NextRequest, userId?: string, metadata?: Record<string, unknown>) {
    return emit('auth:success', req, { success: true, userId, metadata });
  }

  /**
   * Log failed authentication
   */
  function authFail(req: NextRequest, metadata?: Record<string, unknown>) {
    return emit('auth:fail', req, { success: false, metadata });
  }

  /**
   * Log token refresh
   */
  function authRefresh(req: NextRequest, userId?: string, metadata?: Record<string, unknown>) {
    return emit('auth:refresh', req, { success: true, userId, metadata });
  }

  /**
   * Log guest token creation
   */
  function authGuest(req: NextRequest, metadata?: Record<string, unknown>) {
    return emit('auth:guest', req, { success: true, metadata });
  }

  /**
   * Log access denied
   */
  function accessDenied(req: NextRequest, userId?: string, metadata?: Record<string, unknown>) {
    return emit('access:denied', req, { success: false, userId, metadata });
  }

  /**
   * Log CSRF validation failure
   */
  function csrfFail(req: NextRequest, metadata?: Record<string, unknown>) {
    return emit('csrf:fail', req, { success: false, metadata });
  }

  /**
   * Log rate limit exceeded
   */
  function rateLimitExceeded(req: NextRequest, metadata?: Record<string, unknown>) {
    return emit('rateLimit:exceeded', req, { success: false, metadata });
  }

  /**
   * Log general error
   */
  function error(req: NextRequest, err: Error, metadata?: Record<string, unknown>) {
    return emit('error', req, { 
      success: false, 
      metadata: { 
        ...metadata, 
        error: err.message,
        stack: err.stack,
      } 
    });
  }

  return {
    emit,
    isEnabled,
    // Convenience methods
    authSuccess,
    authFail,
    authRefresh,
    authGuest,
    accessDenied,
    csrfFail,
    rateLimitExceeded,
    error,
  };
}

export type AuditLogger = ReturnType<typeof createAuditLogger>;
