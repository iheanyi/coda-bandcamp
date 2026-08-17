import { randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const antiSlopDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(antiSlopDirectory, "../../..");
const generatedDirectory = join(antiSlopDirectory, ".generated");
const generatedPluginPath = join(generatedDirectory, "index.mjs");

async function generatedBundleMatches(contents) {
	try {
		const current = await readFile(generatedPluginPath);
		return current.equals(contents);
	} catch {
		return false;
	}
}

async function buildPlugin() {
	await mkdir(generatedDirectory, { recursive: true });
	const result = await build({
		absWorkingDir: repositoryRoot,
		bundle: true,
		entryPoints: ["tools/oxlint/anti-slop/index.ts"],
		format: "esm",
		legalComments: "none",
		logLevel: "silent",
		outfile: generatedPluginPath,
		platform: "node",
		target: "node20.19",
		write: false,
	});
	const [output] = result.outputFiles;
	if (output === undefined || result.outputFiles.length !== 1) {
		throw new Error("esbuild did not produce exactly one anti-slop plugin bundle.");
	}
	if (await generatedBundleMatches(output.contents)) return;

	const temporaryPath = join(
		generatedDirectory,
		`index.${process.pid}.${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporaryPath, output.contents, { flag: "wx" });
		try {
			// Atomic replacement prevents concurrent lint processes from observing a partial bundle.
			await rename(temporaryPath, generatedPluginPath);
		} catch (cause) {
			// Windows can reject replacement while another process has the identical bundle open.
			if (!(await generatedBundleMatches(output.contents))) throw cause;
		}
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

await buildPlugin();
