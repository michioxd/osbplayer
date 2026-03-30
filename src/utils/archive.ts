import { BlobReader, BlobWriter, TextWriter, ZipReader } from "@zip.js/zip.js";

import type { BlobAssetSource } from "../storyboard/assets";
import { parseDifficultyEntry } from "../storyboard/parser";
import type { DifficultyEntry } from "../types/storyboard";

export interface OszArchiveData {
    difficulties: DifficultyEntry[];
    osbText: string;
    assets: BlobAssetSource;
}

class OszBlobAssetSource implements BlobAssetSource {
    private readonly file: File;
    private readonly entryNames: string[];
    private readonly entryNameSet: Set<string>;
    private readonly blobCache = new Map<string, Blob>();

    constructor(file: File, entryNames: string[]) {
        this.file = file;
        this.entryNames = [...entryNames];
        this.entryNameSet = new Set(entryNames);
    }

    keys(): IterableIterator<string> {
        return this.entryNames.values();
    }

    async loadMany(
        paths: string[],
        onProgress?: (progress: { loaded: number; total: number; currentFile: string }) => void,
    ): Promise<Map<string, Blob>> {
        const uniquePaths = [...new Set(paths)].filter((path) => this.entryNameSet.has(path));
        const blobs = new Map<string, Blob>();
        const missingPaths = uniquePaths.filter((path) => !this.blobCache.has(path));
        const total = uniquePaths.length;
        let loaded = 0;

        for (const path of uniquePaths) {
            const cachedBlob = this.blobCache.get(path);
            if (cachedBlob) {
                blobs.set(path, cachedBlob);
                loaded += 1;
                onProgress?.({ loaded, total, currentFile: path });
            }
        }

        if (missingPaths.length === 0) {
            return blobs;
        }

        const missingPathSet = new Set(missingPaths);
        const zip = new ZipReader(new BlobReader(this.file));

        try {
            const entries = await zip.getEntries();

            for (const entry of entries) {
                if (entry.directory || !missingPathSet.has(entry.filename)) {
                    continue;
                }

                const writer = new BlobWriter();
                await entry.getData?.(writer);
                const blob = await writer.getData();
                this.blobCache.set(entry.filename, blob);
                blobs.set(entry.filename, blob);
                missingPathSet.delete(entry.filename);
                loaded += 1;
                onProgress?.({ loaded, total, currentFile: entry.filename });

                if (missingPathSet.size === 0) {
                    break;
                }
            }

            return blobs;
        } finally {
            await zip.close();
        }
    }
}

export async function loadOszArchive(file: File): Promise<OszArchiveData> {
    const zip = new ZipReader(new BlobReader(file));

    try {
        const entries = await zip.getEntries();
        const difficulties: DifficultyEntry[] = [];
        const assetEntryNames: string[] = [];
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

            assetEntryNames.push(entry.filename);
        }

        difficulties.sort((left, right) => left.name.localeCompare(right.name));

        return {
            difficulties,
            osbText,
            assets: new OszBlobAssetSource(file, assetEntryNames),
        };
    } finally {
        await zip.close();
    }
}
