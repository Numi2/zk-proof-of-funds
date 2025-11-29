
// Log system
export type LogLevel = "info" | "warn" | "error"

export type LogMessage = {
  timestamp: Date
  level: LogLevel
  message: string
}

/** Maximum number of log messages to retain in memory */
const MAX_LOG_MESSAGES = 1000

class LogSystem {
  private logs: LogMessage[] = []
  private subscribers: Set<(log: LogMessage) => void> = new Set()

  error(message: any, error?: any) {
    console.error(message, error)
    this.log(`${message} ${error || ""}`, "error")
  }

  warn(message: string) {
    console.warn(message)
    this.log(message, "warn")
  }

  info(message: string) {
    this.log(message)
  }

  log(message: string, level: LogLevel = "info") {
    const logMessage: LogMessage = {
      timestamp: new Date(),
      level,
      message,
    }
    this.logs.push(logMessage)
    // Prevent unbounded memory growth by trimming old logs
    if (this.logs.length > MAX_LOG_MESSAGES) {
      this.logs = this.logs.slice(-MAX_LOG_MESSAGES)
    }
    this.notifySubscribers(logMessage)
  }

  get(): LogMessage[] {
    return this.logs
  }

  clear(): void {
    this.logs = []
  }

  subscribe(callback: (log: LogMessage) => void): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  private notifySubscribers(log: LogMessage) {
    this.subscribers.forEach((callback) => callback(log))
  }
}

export const log = new LogSystem()
