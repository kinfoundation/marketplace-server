import { Request, RequestHandler, Response } from "express";

import { Application } from "../../models/applications";
import { getDefaultLogger as logger } from "../../logging";
import { BulkUserCreation, InvalidWalletAddress, NoSuchApp, UnknownSignInType, InvalidJwtField } from "../../errors";

import {
	logout as logoutService,
	getOrCreateUserCredentials,
	userExists as userExistsService,
	updateUser as updateUserService,
	activateUser as activateUserService,
	v1GetOrCreateUserCredentials,
	getUserProfile as getUserProfileService,
	register as registerUser,
	getUserBlockchainVersion as getUserBlockchainVersionService,
} from "../services/users";
import {
	SignInContext,
	V1SignInContext,
	validateRegisterJWT,
	v1ValidateRegisterJWT,
	validateWhitelist,
	v1ValidateWhitelist, RegisterPayload,
} from "../services/applications";
import * as metrics from "../../metrics";
import { AuthenticatedRequest } from "../auth";
import { batch } from "../../utils/utils";
import * as jsonwebtoken from "jsonwebtoken";
import { JWTContent } from "../jwt";
import * as httpContext from "express-http-context";

export type V1WalletData = {
	wallet_address: string;
};

export type V1CommonSignInData = V1WalletData & {
	sign_in_type: "jwt" | "whitelist";
	device_id: string;
};

export type V1JwtSignInData = V1CommonSignInData & {
	jwt: string;
	sign_in_type: "jwt";
};

export type V1WhitelistSignInData = V1CommonSignInData & {
	sign_in_type: "whitelist";
	user_id: string;
	api_key: string;
};

export type V1RegisterRequest = Request & { body: V1WhitelistSignInData | V1JwtSignInData };

/**
 * sign in a user,
 * allow either registration with JWT or plain userId to be checked against a whitelist from the given app
 */
export const v1SignInUser = async function(req: V1RegisterRequest, res: Response) {
	let context: V1SignInContext;
	const data: V1WhitelistSignInData | V1JwtSignInData = req.body;

	logger().info("signing in user", { data });
	// XXX should also check which sign in types does the application allow
	if (data.sign_in_type === "jwt") {
		context = await v1ValidateRegisterJWT(data.jwt!);
	} else if (data.sign_in_type === "whitelist") {
		context = await v1ValidateWhitelist(data.user_id, data.api_key);
	} else {
		throw UnknownSignInType((data as any).sign_in_type);
	}

	const app = await Application.get(context.appId);
	if (!app) {
		throw NoSuchApp(context.appId);
	}
	if (!app.supportsSignInType(data.sign_in_type)) {
		throw UnknownSignInType(data.sign_in_type);
	}

	const authToken = await v1GetOrCreateUserCredentials(
		app,
		context.appUserId,
		data.wallet_address,
		data.device_id);

	res.status(200).send(authToken);
} as any as RequestHandler;

export type WalletData = {};

export type CommonSignInData = WalletData & {
	sign_in_type: "jwt" | "whitelist";
};

export type JwtSignInData = CommonSignInData & {
	jwt: string;
	sign_in_type: "jwt";
};

export type WhitelistSignInData = CommonSignInData & {
	sign_in_type: "whitelist";
	user_id: string;
	api_key: string;
	device_id: string;
};

export type RegisterRequest = Request & { body: WhitelistSignInData | JwtSignInData };

/**
 * sign in a user,
 * allow either registration with JWT or plain userId to be checked against a whitelist from the given app
 */
export const signInUser = async function(req: RegisterRequest, res: Response) {
	let context: SignInContext;
	const data: WhitelistSignInData | JwtSignInData = req.body;

	logger().info("signing in user", { data });
	// XXX should also check which sign in types does the application allow
	if (data.sign_in_type === "jwt") {
		context = await validateRegisterJWT(data.jwt!);
	} else if (data.sign_in_type === "whitelist") {
		context = await validateWhitelist(data.user_id, data.device_id, data.api_key);
	} else {
		throw UnknownSignInType((data as any).sign_in_type);
	}

	const app = (await Application.all()).get(context.appId);
	if (!app) {
		throw NoSuchApp(context.appId);
	}
	if (!app.supportsSignInType(data.sign_in_type)) {
		throw UnknownSignInType(data.sign_in_type);
	}

	const authToken = await getOrCreateUserCredentials(
		app,
		context.appUserId,
		context.deviceId);

	res.status(200).send(authToken);
} as any as RequestHandler;

export type UpdateUserRequest = AuthenticatedRequest & { body: WalletData };

export const updateUser = async function(req: UpdateUserRequest, res: Response) {
	const user = req.context.user;
	const deviceId = req.body.device_id || req.context.token.deviceId;
	const walletAddress = req.body.wallet_address;

	logger().info(`updating user ${ user.id }`, { walletAddress, deviceId });

	if (!walletAddress || walletAddress.length !== 56) {
		throw InvalidWalletAddress(walletAddress);
	}

	await updateUserService(user, { deviceId, walletAddress });

	res.status(204).send();
} as any as RequestHandler;

export type UserExistsRequest = AuthenticatedRequest & { query: { user_id: string; } };

export const userExists = async function(req: UserExistsRequest, res: Response) {
	const appId = req.context.user.appId;
	const userFound = await userExistsService(appId, req.query.user_id);
	res.status(200).send(userFound);
} as any as RequestHandler;

/**
 * user activates by approving TOS
 */
export const activateUser = async function(req: AuthenticatedRequest, res: Response) {
	const authToken = await activateUserService(req.context.token, req.context.user);
	res.status(200).send(authToken);
} as any as RequestHandler;

export type UserInfoRequest = AuthenticatedRequest & { params: { user_id: string; } };

export const v1UserInfo = async function(req: UserInfoRequest, res: Response) {
	logger().debug(`userInfo userId: ${ req.params.user_id }`);

	if (req.context.user.appUserId !== req.params.user_id) {
		const userFound = await userExistsService(req.context.user.appId, req.params.user_id);
		if (userFound) {
			res.status(200).send({});
		} else {
			res.status(404).send();
		}
	} else {
		const profile = await getUserProfileService(req.context.user.id, req.context.token.deviceId);
		delete profile.created_date;
		delete profile.current_wallet;
		res.status(200).send(profile);
	}
} as any as RequestHandler;

export const v1MyUserInfo = async function(req: AuthenticatedRequest, res: Response) {
	req.params.user_id = req.context.user.appUserId;
	await (v1UserInfo as any)(req as UserInfoRequest, res);
} as any as RequestHandler;

export const userInfo = async function(req: UserInfoRequest, res: Response) {
	logger().debug(`userInfo userId: ${ req.params.user_id }`);

	if (req.context.user.appUserId !== req.params.user_id) {
		const userFound = await userExistsService(req.context.user.appId, req.params.user_id);
		if (userFound) {
			res.status(200).send({});
		} else {
			res.status(404).send();
		}
	} else {
		const profile = await getUserProfileService(req.context.user.id, req.context.token.deviceId);
		res.status(200).send(profile);
	}
} as any as RequestHandler;

export const myUserInfo = async function(req: AuthenticatedRequest, res: Response) {
	req.params.user_id = req.context.user.appUserId;
	await (userInfo as any)(req as UserInfoRequest, res);
} as any as RequestHandler;

export const logoutUser = async function(req: AuthenticatedRequest, res: Response) {
	await logoutService(req.context.user, req.context.token);
	res.status(204).send();
} as any as RequestHandler;

export type BulkUserCreationRequest = Request & { body: { app_id: string, user_data: Array<[string, string]> } };

export const bulkUserCreation = async function(req: BulkUserCreationRequest, res: Response) {
	const jwtList = req.body.user_data as Array<[string, string]>;
	const firstJwt = jsonwebtoken.decode(jwtList[0][0], { complete: true }) as JWTContent<Partial<RegisterPayload>, "register">; // Use the app id from the first JWT
	const app_id = firstJwt.payload.iss;
	logger().info(`bulkUserCreation of ${ jwtList.length } users for ${ app_id }`);
	const app = await Application.get(app_id);
	if (!app) {
		throw NoSuchApp(app_id);
	}
	let allowedCreations = app.config.bulk_user_creation_allowed || 0;
	if (!allowedCreations || allowedCreations < jwtList.length) {
		throw BulkUserCreation(app.id, jwtList.length, allowedCreations);
	}
	metrics.bulkUserCreationRequest(app_id, jwtList.length);
	res.write(`requestId: ${ httpContext.get("reqId") }\n`);
	const butchSize = app.config.limits.minute_registration * 0.7;
	const butchDelay = 61 * 1000;
	await batch(jwtList, butchSize, butchDelay, async (sublist: Array<[string, string]>, firstIndexOfChunk) => {
			await Promise.all(sublist.map(async ([jwt, publicAddress], index) => {
				const currentItem = firstIndexOfChunk + (index + 1);
				const context = await validateRegisterJWT(jwt);
				const deviceId = context.deviceId;
				if (context.appId !== app_id) {
					throw InvalidJwtField("issuer (iss) field of all supplied JWT must match");
				}
				logger().info(`Creating account for app user id: ${ context.appUserId }, public address: ${ publicAddress }`);
				const { user } = await registerUser(
					app,
					context.appUserId,
					app.id,
					deviceId);
				logger().info(`updateUserService user id ${ context.appUserId }`);
				await updateUserService(user, { deviceId, walletAddress: publicAddress });
				logger().info(`User ${ context.appUserId } update, currentItem: ${ currentItem }`);
				allowedCreations--;
				metrics.bulkUserCreated(app_id);
				res.write(`created user ${ currentItem }: ${ context.appUserId } (${ user.id }), device id: ${ deviceId }, public address ${ publicAddress }\n`);
			}));
	});

	logger().info(`new allowedCreations: ${ allowedCreations }`);
	app.config.bulk_user_creation_allowed = allowedCreations;
	await app.save();
	res.write(`Created user accounts, requestId: ${ httpContext.get("reqId") }\n`);
	res.status(200).end();
};

export const getUserBlockchainVersion = async function(req: Request, res: Response) {
	const blockchainVersion = await getUserBlockchainVersionService(req.params.wallet_address);
	res.status(200).send(blockchainVersion);
} as any as RequestHandler;
