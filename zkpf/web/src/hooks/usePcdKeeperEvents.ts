/**
 * React hook for subscribing to PCD Keeper events via WebSocket.
 *
 * Provides real-time updates from the autonomous PCD Keeper running
 * in the Shade Agent TEE.
 *
 * @example
 * ```tsx
 * function KeeperStatus() {
 *   const { status, events, isConnected, requestSync } = usePcdKeeperEvents();
 *
 *   return (
 *     <div>
 *       <p>Connected: {isConnected ? 'Yes' : 'No'}</p>
 *       <p>PCD Height: {status?.pcdHeight}</p>
 *       <p>Blocks Behind: {status?.blocksBehind}</p>
 *       <button onClick={requestSync}>Force Sync</button>
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Keeper status DTO from the WebSocket server.
 */
export interface KeeperStatus {
  /** Whether the keeper is running. */
  isRunning: boolean;
  /** Current PCD height (scanned). */
  pcdHeight: number;
  /** Current chain height. */
  chainHeight: number;
  /** Blocks behind chain tip. */
  blocksBehind: number;
  /** Last sync timestamp (Unix ms). */
  lastSyncAt: number | null;
  /** Number of pending tachystamps. */
  pendingTachystamps: number;
  /** Total syncs performed. */
  totalSyncs: number;
  /** Total tachystamps submitted. */
  totalTachystampsSubmitted: number;
  /** Current epoch number. */
  currentEpoch: number | null;
}

/**
 * Configuration summary from the keeper.
 */
export interface KeeperConfigSummary {
  minBlocksBehind: number;
  maxBlocksBehind: number;
  pollIntervalSecs: number;
  autoSubmitTachystamps: boolean;
  epochStrategy: string;
}

/**
 * Sync result from the keeper.
 */
export interface SyncResult {
  newHeight: number;
  blocksSynced: number;
  notesDiscovered: number;
  durationMs: number;
  success: boolean;
  error: string | null;
}

/**
 * Keeper event types.
 */
export type KeeperEventType =
  | 'connected'
  | 'keeper_started'
  | 'keeper_stopped'
  | 'sync_started'
  | 'sync_completed'
  | 'tachystamp_queued'
  | 'tachystamp_submitted'
  | 'epoch_boundary'
  | 'warning'
  | 'error'
  | 'status_update';

/**
 * Keeper event (received from WebSocket).
 */
export interface KeeperEvent {
  type: KeeperEventType;
  data: unknown;
  timestamp: number;
}

/**
 * Keeper started event data.
 */
export interface KeeperStartedData {
  configSummary: KeeperConfigSummary;
}

/**
 * Sync started event data.
 */
export interface SyncStartedData {
  fromHeight: number;
  toHeight: number;
}

/**
 * Tachystamp queued event data.
 */
export interface TachystampQueuedData {
  policyId: number;
  epoch: number;
  queuePosition: number;
}

/**
 * Tachystamp submitted event data.
 */
export interface TachystampSubmittedData {
  policyId: number;
  epoch: number;
  tachystampId: string;
}

/**
 * Epoch boundary event data.
 */
export interface EpochBoundaryData {
  oldEpoch: number;
  newEpoch: number;
}

/**
 * Warning event data.
 */
export interface WarningData {
  code: string;
  message: string;
}

/**
 * Error event data.
 */
export interface ErrorData {
  code: string;
  message: string;
  recoverable: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface UsePcdKeeperEventsOptions {
  /** WebSocket URL. Defaults to /keeper-ws or derived from window location. */
  url?: string;
  /** Event types to subscribe to. Empty = all. */
  eventTypes?: KeeperEventType[];
  /** Auto-connect on mount. Default: true. */
  autoConnect?: boolean;
  /** Reconnect on disconnect. Default: true. */
  reconnect?: boolean;
  /** Reconnect delay in ms. Default: 3000. */
  reconnectDelay?: number;
  /** Max reconnect attempts. Default: 10. */
  maxReconnectAttempts?: number;
  /** Max events to keep in history. Default: 100. */
  maxEvents?: number;
  /** Status update interval request (seconds). */
  statusInterval?: number;
  /** Callback for events. */
  onEvent?: (event: KeeperEvent) => void;
  /** Callback for connection state changes. */
  onConnectionChange?: (connected: boolean) => void;
  /** Callback for errors. */
  onError?: (error: Error) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK RESULT
// ═══════════════════════════════════════════════════════════════════════════════

export interface UsePcdKeeperEventsResult {
  /** Whether connected to the keeper. */
  isConnected: boolean;
  /** Whether connecting. */
  isConnecting: boolean;
  /** Current keeper status. */
  status: KeeperStatus | null;
  /** Configuration summary. */
  config: KeeperConfigSummary | null;
  /** Event history (most recent first). */
  events: KeeperEvent[];
  /** Last error. */
  lastError: Error | null;
  /** Reconnect attempts made. */
  reconnectAttempts: number;
  /** Connect to the keeper WebSocket. */
  connect: () => void;
  /** Disconnect from the keeper. */
  disconnect: () => void;
  /** Request a PCD sync. */
  requestSync: () => Promise<void>;
  /** Request current status. */
  requestStatus: () => Promise<KeeperStatus | null>;
  /** Clear event history. */
  clearEvents: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT VALUES
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_WS_URL = (() => {
  if (typeof window === 'undefined') return 'ws://localhost:3001';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, use dedicated port; in production, use same origin
  if (import.meta.env?.DEV) {
    return 'ws://localhost:3001';
  }
  return `${protocol}//${window.location.host}/keeper-ws`;
})();

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

export function usePcdKeeperEvents(
  options: UsePcdKeeperEventsOptions = {}
): UsePcdKeeperEventsResult {
  const {
    url = DEFAULT_WS_URL,
    eventTypes = [],
    autoConnect = true,
    reconnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 10,
    maxEvents = 100,
    statusInterval,
    onEvent,
    onConnectionChange,
    onError,
  } = options;

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<KeeperStatus | null>(null);
  const [config, setConfig] = useState<KeeperConfigSummary | null>(null);
  const [events, setEvents] = useState<KeeperEvent[]>([]);
  const [lastError, setLastError] = useState<Error | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef<Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>>(new Map());

  // Generate unique request ID
  const generateRequestId = useCallback(() => {
    requestIdRef.current += 1;
    return `req-${Date.now()}-${requestIdRef.current}`;
  }, []);

  // Add event to history
  const addEvent = useCallback(
    (event: KeeperEvent) => {
      setEvents((prev) => {
        const newEvents = [event, ...prev];
        return newEvents.slice(0, maxEvents);
      });
      onEvent?.(event);
    },
    [maxEvents, onEvent]
  );

  // Handle incoming WebSocket messages
  const handleMessage = useCallback(
    (messageEvent: MessageEvent) => {
      try {
        const message = JSON.parse(messageEvent.data);
        const type = message.type as KeeperEventType;
        const data = message.data;

        const event: KeeperEvent = {
          type,
          data,
          timestamp: Date.now(),
        };

        // Filter by event types if specified
        if (eventTypes.length > 0 && !eventTypes.includes(type)) {
          return;
        }

        // Handle specific event types
        switch (type) {
          case 'connected':
            console.log('[PcdKeeper] Connected:', data);
            break;

          case 'keeper_started':
            if (data?.configSummary) {
              setConfig(data.configSummary);
            }
            break;

          case 'keeper_stopped':
            setStatus(null);
            break;

          case 'sync_completed':
            // Update status after sync
            if (data?.newHeight) {
              setStatus((prev) => prev ? { ...prev, pcdHeight: data.newHeight } : null);
            }
            break;

          case 'status_update':
            if (data) {
              setStatus(data as KeeperStatus);
            }
            break;

          case 'error':
            if (data) {
              const errorData = data as ErrorData;
              setLastError(new Error(`[${errorData.code}] ${errorData.message}`));
              onError?.(new Error(errorData.message));
            }
            break;

          case 'warning':
            console.warn('[PcdKeeper Warning]', data);
            break;
        }

        // Handle response to pending requests
        if (type === 'response' as KeeperEventType) {
          const responseData = data as { requestId: string; success: boolean; data?: unknown; error?: string };
          const pending = pendingRequestsRef.current.get(responseData.requestId);
          if (pending) {
            pendingRequestsRef.current.delete(responseData.requestId);
            if (responseData.success) {
              pending.resolve(responseData.data);
            } else {
              pending.reject(new Error(responseData.error ?? 'Unknown error'));
            }
          }
        }

        addEvent(event);
      } catch (err) {
        console.error('[PcdKeeper] Failed to parse message:', err);
      }
    },
    [eventTypes, addEvent, onError]
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setIsConnecting(true);
    setLastError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[PcdKeeper] WebSocket connected');
        setIsConnected(true);
        setIsConnecting(false);
        setReconnectAttempts(0);
        onConnectionChange?.(true);

        // Send subscription message
        if (eventTypes.length > 0) {
          ws.send(JSON.stringify({
            type: 'subscribe',
            data: { event_types: eventTypes },
          }));
        }

        // Request initial status
        ws.send(JSON.stringify({
          type: 'get_status',
          data: { request_id: generateRequestId() },
        }));
      };

      ws.onmessage = handleMessage;

      ws.onerror = (event) => {
        console.error('[PcdKeeper] WebSocket error:', event);
        const error = new Error('WebSocket connection error');
        setLastError(error);
        onError?.(error);
      };

      ws.onclose = (event) => {
        console.log('[PcdKeeper] WebSocket closed:', event.code, event.reason);
        wsRef.current = null;
        setIsConnected(false);
        setIsConnecting(false);
        onConnectionChange?.(false);

        // Attempt reconnect if enabled
        if (reconnect && reconnectAttempts < maxReconnectAttempts) {
          setReconnectAttempts((prev) => prev + 1);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`[PcdKeeper] Reconnecting (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})...`);
            connect();
          }, reconnectDelay);
        }
      };
    } catch (err) {
      console.error('[PcdKeeper] Failed to create WebSocket:', err);
      setIsConnecting(false);
      const error = err instanceof Error ? err : new Error(String(err));
      setLastError(error);
      onError?.(error);
    }
  }, [
    url,
    eventTypes,
    reconnect,
    reconnectAttempts,
    maxReconnectAttempts,
    reconnectDelay,
    handleMessage,
    generateRequestId,
    onConnectionChange,
    onError,
  ]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setReconnectAttempts(0);
  }, []);

  // Request a PCD sync
  const requestSync = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const requestId = generateRequestId();

    return new Promise<void>((resolve, reject) => {
      pendingRequestsRef.current.set(requestId, {
        resolve: () => resolve(),
        reject,
      });

      wsRef.current!.send(JSON.stringify({
        type: 'request_sync',
        data: { request_id: requestId },
      }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }, [generateRequestId]);

  // Request current status
  const requestStatus = useCallback(async (): Promise<KeeperStatus | null> => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const requestId = generateRequestId();

    return new Promise((resolve, reject) => {
      pendingRequestsRef.current.set(requestId, {
        resolve: (data) => resolve(data as KeeperStatus | null),
        reject,
      });

      wsRef.current!.send(JSON.stringify({
        type: 'get_status',
        data: { request_id: requestId },
      }));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }, [generateRequestId]);

  // Clear event history
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Setup status polling interval
  useEffect(() => {
    if (statusInterval && isConnected && wsRef.current) {
      statusIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'get_status',
            data: { request_id: generateRequestId() },
          }));
        }
      }, statusInterval * 1000);
    }

    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };
  }, [statusInterval, isConnected, generateRequestId]);

  return {
    isConnected,
    isConnecting,
    status,
    config,
    events,
    lastError,
    reconnectAttempts,
    connect,
    disconnect,
    requestSync,
    requestStatus,
    clearEvents,
  };
}

export default usePcdKeeperEvents;

