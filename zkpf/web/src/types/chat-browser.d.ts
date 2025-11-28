declare module 'chat-browser' {
  /**
   * Options for building shareable tickets.
   *
   * Mirrors the Rust `TicketOpts` type:
   * - `includeMyself`: always include our own endpoint id.
   * - `includeBootstrap`: include known bootstrap peers for this channel.
   * - `includeNeighbors`: include currently-connected neighbors.
   */
  export interface TicketOpts {
    includeMyself: boolean;
    includeBootstrap: boolean;
    includeNeighbors: boolean;
  }

  /**
   * Gossip chat events emitted by the underlying iroh-gossip stack.
   * This is a narrowed view containing only the fields the web app uses.
   */
  export type ChatEvent =
    | {
        type: 'messageReceived';
        from: string;
        text: string;
        nickname?: string;
        sentTimestamp?: number;
      }
    | {
        type: 'presence';
        from: string;
        nickname: string;
        sentTimestamp: number;
      }
    | {
        type: 'joined';
        neighbors?: string[];
      }
    | {
        type: 'neighborUp';
        endpoint_id?: string;
      }
    | {
        type: 'neighborDown';
        endpoint_id?: string;
      }
    // Fallback for any future event types we don't care about yet.
    | {
        type: string;
        // biome-ignore lint/suspicious/noExplicitAny: ambient declaration for external module
        [key: string]: any;
      };

  export class ChannelSender {
    broadcast(text: string): Promise<void>;
    /**
     * Note: the underlying wasm binding exposes this with a small typo
     * (`set_nickame`). We mirror that here to stay compatible.
     */
    set_nickame(nickname: string): void;
  }

  /**
   * A chat channel bound to a deterministic topic (e.g. an offerId).
   *
   * - `sender`: used to broadcast messages.
   * - `receiver`: a ReadableStream of `ChatEvent` objects.
   */
  export class Channel {
    sender: ChannelSender;
    receiver: ReadableStream<ChatEvent>;

    ticket(opts: TicketOpts): string;
    id(): string;
    neighbors(): string[];
  }

  export class ChatNode {
    static spawn(): Promise<ChatNode>;

    endpoint_id(): string;

    create(nickname: string): Promise<Channel>;
    create_with_offer(offerId: string, nickname: string): Promise<Channel>;

    join(ticket: string, nickname: string): Promise<Channel>;
    ticket_for_offer(offerId: string, opts: TicketOpts): string;
  }
}

