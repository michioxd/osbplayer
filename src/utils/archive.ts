import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";

import { parseDifficultyEntry } from "../storyboard/parser";
import type { DifficultyEntry } from "../types/storyboard";

export interface OszArchiveData {
    difficulties: DifficultyEntry[];
    osbText: string;
    assets: Map<string, Blob>;
}

export async function loadOszArchive(file: File): Promise<OszArchiveData> {
    const zip = new ZipReader(new BlobReader(file));

    try {
        const entries = await zip.getEntries();
        const difficulties: DifficultyEntry[] = [];
        const assets = new Map<string, Blob>();
        let osbText = "";

        for (const entry of entries) {
            if (entry.directory) {
                continue;
            }

            if (entry.filename.toLowerCase().endsWith(".osu")) {
                const writer = new TextWriter();
                await entry.getData?.(writer);
                const content = await writer.getData();
                const difficulty = parseDifficultyEntry(content, entry.filename);
                difficulties.push(difficulty);
                continue;
            }

            if (entry.filename.toLowerCase().endsWith(".osb")) {
                const writer = new TextWriter();
                await entry.getData?.(writer);
                osbText = await writer.getData();
                continue;
            }

            const writer = new BlobWriter();
            await entry.getData?.(writer);
            const blob = await writer.getData();
            assets.set(entry.filename, blob);
        }

        difficulties.sort((left, right) => left.name.localeCompare(right.name));

        return {
            difficulties,
            osbText,
            assets,
        };
    } finally {
        await zip.close();
    }
}
