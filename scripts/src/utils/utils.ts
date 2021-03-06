import * as _path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

import { path } from "./path";
import { getRedisClient, RedisAsyncClient } from "../redis";

export type ServerError = Error & { syscall: string; code: string; };

export type SimpleObject<T = any> = { [key: string]: T };

export function isSimpleObject(obj: any): obj is SimpleObject {
	return typeof obj === "object" && !Array.isArray(obj);
}

export type Nothing = null | undefined;

export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export function isNothing(obj: any): obj is Nothing {
	return obj === null || obj === undefined;
}

export function getOrDefault<T, S extends T>(value: T | undefined | null, defaultValue: S): T {
	if (isNothing(value)) {
		return defaultValue;
	}
	return value;
}

export function random(): number;
export function random(min: number, max: number): number;

export function random<T = any>(arr: T[]): T;
export function random<T = any>(map: Map<string, T>): [string, T];
export function random<T = any>(obj: SimpleObject<T>): [string, T];

export function random(first?: number | Map<string, any> | SimpleObject | any[], second?: number): number | [string, any] | any {
	if (first instanceof Map) {
		first = Array.from(first.entries());
	} else if (isSimpleObject(first)) {
		first = Object.keys(first).map(key => [key, (first as SimpleObject)[key]]);
	}

	if (Array.isArray(first)) {
		return first[Math.floor(Math.random() * first.length)];
	}

	if (first !== undefined && second !== undefined) {
		return Math.random() * (second - (first as number)) + (first as number);
	}

	return Math.random();
}

// return a random number between min (including) and max (excluding) i.e. min <= rand() < max
export function randomInteger(min: number, max: number): number {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}

export enum IdPrefix {
	User = "U",
	App = "A",
	Transaction = "T",
	Offer = "O",
	BlockchainPublicAddress = "G",
	None = "",
}

const ID_LENGTH = 20;
const ID_CHARS = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generating id uses cryptographic randomness
 * randomInts is an array filled with random integers 0-255
 * Every int converted into ID_CHARS place
 *
 * @param      {IdPrefix}  prefix  The id prefix
 * @return     {string}  random string of ID_LENGTH length
 */
export function generateId(prefix: IdPrefix | string = IdPrefix.None): string {
	return generateRandomString({ prefix, baseLength: ID_LENGTH });
}

export type GenerateRandomStringOptions = {
	prefix?: string,
	minLength?: number,  // Minimum length of the string. Any affix (like prefix) length will be in addition
	baseLength?: number,  // Like minLength but disables random length
	length?: number, //  includes the length of any prefix (or other affix) has precedence over baseLength
};

export function generateRandomString(options: GenerateRandomStringOptions = {}): string {
	const MAXIMUM_RANDOM_LENGTH = 100;
	const prefix = options.prefix || "";
	let length = options.baseLength || Math.floor(Math.random() * MAXIMUM_RANDOM_LENGTH);
	if (options.length) {
		length = options.length - prefix.length;
	}
	length = Math.max(length, options.minLength || 0);
	if (length <= 0) {
		throw Error("Requested Length can't be equal or less than prefix length or 0");
	}
	const buffer = Buffer.alloc(length);
	const randomInts = new Uint8Array(crypto.randomFillSync(buffer)); // not async function for keeping existing function interface the same

	return prefix + randomInts.reduce(
		(str, int) => str + ID_CHARS[Math.trunc(int / 256 * ID_CHARS.length)], "");
}

export function normalizeError(error: string | Error | any): string {
	if (isNothing(error)) {
		return "";
	}

	if (typeof error === "string") {
		return error;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return error.toString();
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function pick<T, K extends keyof T>(obj: T, ...props: K[]): Pick<T, K> {
	const newObj = {} as Pick<T, K>;
	props.forEach(name => newObj[name] = obj[name]);
	return newObj;
}

export function removeDuplicates<T>(arr: T[]): T[] {
	return Array.from(new Set(arr));
}

export async function retry<T>(fn: () => T, predicate: (o: any) => boolean, errorMessage?: string): Promise<T> {
	for (let i = 0; i < 30; i++) {
		const obj = await fn();
		if (predicate(obj)) {
			return obj;
		}
		await delay(1000);
		console.log("retrying...");
	}
	throw new Error(errorMessage || "failed");
}

export type KeyMap = { [name: string]: { algorithm: string, key: string } };

/**
 * read all keys from a directory
 */
export function readKeysDir(dir: string): KeyMap {
	const keys: KeyMap = {};
	fs.readdirSync(path(dir)).forEach(filename => {
		if (!filename.endsWith(".pem")) {
			console.info(`readKeysDir: skipping non pem file ${ filename }`);
			return;
		}
		// filename format is kin-es256_0.pem or kin-es256_0-priv.pem or es256_0-priv.pem
		const keyid = filename.replace(/-priv/, "").split(".")[0];
		const algorithm = filename.split("_")[0].toUpperCase();
		keys[keyid] = {
			algorithm,
			key: fs.readFileSync(path(_path.join(dir, filename))).toString()
		};
	});
	return keys;
}

export function readUTCDate(date: string | Date): Date {
	if (date instanceof Date) {
		return date;
	} else if (date.endsWith("Z")) {
		return new Date(date);
	}
	return new Date(date + "Z");
}

export function capitalizeFirstLetter(str: string) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

const dateFormat = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*))(?:Z|(\+|-)([\d|:]*))?$/;

export function dateParser(key: string, value: string) {
	if (typeof value === "string" && dateFormat.test(value)) {
		return new Date(value);
	}

	return value;
}

export async function batch(list: any[], chunkSize: number, delay: number, chunkCb: (chunk: any[], firstIndexOfChunk: number) => Promise<void>) {
	return new Promise(async resolve => {
		const runner = async (index: number, ...args: any[]) => {
			const end = index + chunkSize;
			if (end > list.length - 1) {  // last chunk
				console.log("calling last chunkCb, index: %s, list.length: %s", index, list.length);
				chunkCb(list.slice(index), index).then(() => {
					resolve();
				});
				return;
			}
			console.log("calling ChunkCb, index: %s, list.length: %s", index, list.length);
			return chunkCb(list.slice(index, end), index).then(async () => {
				setTimeout(runner.bind(runner, end, ...args), delay);
			});
		};
		runner(0);
	});
}

// cache a function that returns a promise
// use keygen to calcualte the cache key
// add a .clear method on the function to clear the cache.
export function cached(cache: RedisAsyncClient, keygen: (...args: any[]) => string, timeout: number) {
	return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		descriptor.value = async function() {
			const cacheKey = keygen(...arguments);
			const resultStr = await cache.async.get(cacheKey);
			let result = resultStr ? JSON.parse(resultStr) : undefined;
			if (!result) {
				result = await originalMethod.apply(this, arguments);
				if (result) {
					await cache.async.setex(cacheKey, timeout, JSON.stringify(result));
				}
			}
			return result;
		};
		descriptor.value.clear = async function() {
			const cacheKey = keygen(...arguments);
			await cache.async.del(cacheKey);
		};
		return descriptor;
	};
}

export type Memo = {
	version: string;
	appId: string;
	orderId: string;
};

/*
A memo is structured as {version}-{appId}-{orderId}
e.g. 1-kik-xapp_kit_125
*/
export function parseMemo(memo: string): Memo{
	const parts = memo.split("-");
	return {
		version: parts[0],
		appId: parts[1],
		orderId: parts[2]
	};
}

export function transferKey(orderId: string): string {
	return `transfer:${orderId}`;
}
