type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: Date;
}

type Listener = (entry: LogEntry) => void;

class Logger {
    private listeners = new Set<Listener>();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    info(...parts: unknown[]): void {
        this.emit("info", parts);
    }

    warn(...parts: unknown[]): void {
        this.emit("warn", parts);
    }

    error(...parts: unknown[]): void {
        this.emit("error", parts);
    }

    private emit(level: LogLevel, parts: unknown[]): void {
        const message = parts
            .map((part) => {
                if (part instanceof Error) {
                    return part.message;
                }

                if (typeof part === "string") {
                    return part;
                }

                try {
                    return JSON.stringify(part);
                } catch (error) {
                    if (error instanceof TypeError) {
                        return "[Circular]";
                    }

                    return String(part);
                }
            })
            .join(" ");

        const entry: LogEntry = {
            level,
            message,
            timestamp: new Date(),
        };

        if (level === "error") {
            console.error(...parts);
        } else if (level === "warn") {
            console.warn(...parts);
        } else {
            console.log(...parts);
        }

        for (const listener of this.listeners) {
            listener(entry);
        }
    }
}

export const logger = new Logger();
