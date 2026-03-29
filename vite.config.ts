import { defineConfig } from "vite";
import { execSync } from "child_process";
import { ViteMinifyPlugin } from "vite-plugin-minify";
import preload from "vite-plugin-preload";
import viteCompression from "vite-plugin-compression";

const buildTime = Date.now();
const buildDate = new Date(buildTime).toISOString();
const gitCommit = getGitValue("git rev-parse --short HEAD", process.env.GIT_COMMIT_SHORT, "unknown");
const gitCommitFull = getGitValue("git rev-parse HEAD", process.env.GIT_COMMIT, gitCommit);
const gitCurrentBranch = getGitValue("git rev-parse --abbrev-ref HEAD", process.env.GIT_BRANCH, "unknown");

function getGitValue(command: string, fallbackFromEnv: string | undefined, fallback: string): string {
    try {
        return (
            execSync(command, { stdio: ["ignore", "pipe", "ignore"] })
                .toString()
                .trim() || fallback
        );
    } catch {
        return fallbackFromEnv?.trim() || fallback;
    }
}

export default defineConfig({
    plugins: [
        ViteMinifyPlugin({
            ignoreCustomComments: [],
        }),
        viteCompression(),
        preload(),
    ],
    define: {
        "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
        "import.meta.env.VITE_BUILD_DATE": JSON.stringify(buildDate),
        "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(gitCommit),
        "import.meta.env.VITE_GIT_COMMIT_FULL": JSON.stringify(gitCommitFull),
        "import.meta.env.VITE_GIT_CURRENT_BRANCH": JSON.stringify(gitCurrentBranch),
    },
    build: {
        minify: "terser",
        sourcemap: "hidden",
        cssCodeSplit: false,
        terserOptions: {
            parse: {
                html5_comments: false,
            },
            format: {
                comments: false,
            },
        },
    },
});
