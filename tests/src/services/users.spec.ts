import * as expect from "expect";
import mock = require("supertest");
import { Response } from "supertest";

import { app } from "../../../scripts/bin/public/app";
import * as metrics from "../../../scripts/bin/metrics";
import { AuthToken, User } from "../../../scripts/bin/models/users";
import { generateId, IdPrefix } from "../../../scripts/bin/utils/utils";
import { WhitelistSignInData } from "../../../scripts/bin/public/routes/users";
import { close as closeModels, init as initModels } from "../../../scripts/bin/models/index";
import { AuthToken as ApiAuthToken, userExists, UserProfile } from "../../../scripts/bin/public/services/users";

import * as helpers from "../helpers";

describe("api tests for /users", async () => {
	beforeAll(async done => {
		await initModels();
		helpers.patchDependencies();
		done();
	});

	afterAll(async () => {
		await closeModels();
		await metrics.destruct();
	});

	test("user register whitelist", async () => {
		const myApp = await helpers.createApp(generateId(IdPrefix.App));
		const signInData: WhitelistSignInData = {
			sign_in_type: "whitelist",
			api_key: myApp.apiKey,
			device_id: "my_device_id",
			user_id: "my_app_user_id"
		};

		const res = await mock(app)
			.post(`/v2/users/`)
			.send(signInData)
			.set("x-request-id", "123");

		const token: ApiAuthToken = res.body.auth;
		expect(token.app_id).toEqual(myApp.id);
		const lastCreatedToken = (await AuthToken.findOne({ order: { createdDate: "DESC" } }))!;
		expect(token.token).toEqual(lastCreatedToken.id);
	});

	test("user profile test", async () => {
		const appId = generateId(IdPrefix.App);
		const user1 = await helpers.createUser({ appId, deviceId: "test_device_id1" });
		const user2 = await helpers.createUser({ appId, deviceId: "test_device_id2" });
		const token = (await AuthToken.findOne({ userId: user1.id }))!;

		await mock(app)
			.get(`/v2/users/non_user`)
			.set("x-request-id", "123")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(404, {});

		await mock(app)
			.get(`/v2/users/${ user1.appUserId }`)
			.set("x-request-id", "123")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect((res: { body: UserProfile; }) => {
				if (res.body.created_date === undefined) {
					throw new Error("created_date missing");
				}
				if (res.body.stats.earn_count === undefined) {
					throw new Error("stats.earn_count missing");
				}
				if (res.body.stats.spend_count === undefined) {
					throw new Error("stats.spend_count missing");
				}
			});

		await mock(app)
			.get(`/v2/users/${ user2.appUserId }`)
			.set("x-request-id", "123")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(200, {});

		await helpers.createOrders(user1.id); // creates 1 pending and 1 completed and 1 failed of earn and spend

		await mock(app)
			.get(`/v2/users/${ user1.appUserId }`)
			.set("x-request-id", "123")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(200)
			.expect((res: Response) => {
				if (res.body.stats.earn_count !== 2 || res.body.stats.spend_count !== 2) {
					throw new Error("unexpected body: " + JSON.stringify(res.body));
				}
			});

		// different appId
		const user3 = await helpers.createUser({ appId: generateId(IdPrefix.App) });
		await mock(app)
			.get(`/v2/users/${ user3.appUserId }`)
			.set("x-request-id", "123")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(404);
	});

	test("updateUser", async () => {
		const testApp = await helpers.createApp(generateId(IdPrefix.App));
		const newWalletAddress = "new_address_must_be_56_characters____bla___bla___bla____";
		const badAddress = "new_address_not_56_chars";
		const deviceId = "test_device_id";

		let user = await helpers.createUser({ appId: testApp.id, deviceId });
		const token = (await AuthToken.findOne({ userId: user.id }))!;

		await mock(app)
			.patch("/v2/users/me")
			.send({ wallet_address: newWalletAddress })
			.set("content-type", "application/json")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(204);

		user = (await User.findOne({ id: user.id }))!;

		let wallets = (await user.getWallets()).all().map(wallet => wallet.address);
		const walletsCount = wallets.length;
		expect(wallets).toContain(newWalletAddress);

		await mock(app)
			.patch("/v2/users/me")
			.send({ wallet_address: badAddress })
			.set("content-type", "applications/json")
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(400);

		user = (await User.findOne({ id: user.id }))!;
		wallets = (await user.getWallets()).all().map(wallet => wallet.address);
		expect(wallets).not.toContain(badAddress);
		expect(wallets.length).toBe(walletsCount);
	});

	test("userExists", async () => {
		const user = await helpers.createUser();
		expect(await userExists(user.appId, user.appUserId)).toBeTruthy();
		expect(await userExists("another-app", user.appUserId)).toBeFalsy();
		expect(await userExists(user.appId, "another-user-id")).toBeFalsy();
	});

	test("logout", async () => {
		const user = await helpers.createUser();
		let token = (await AuthToken.findOne({ userId: user.id }))!;
		expect(token.valid).toBeTruthy();

		await mock(app)
			.delete("/v2/users/me/session")
			.send()
			.set("Authorization", `Bearer ${ token.id }`)
			.expect(204);

		token = (await AuthToken.findOne({ userId: user.id }))!;
		expect(token.valid).toBeFalsy();
	});

	test("logout through API", async () => {
		const myApp = await helpers.createApp(IdPrefix.App);
		const signInData: WhitelistSignInData = {
			sign_in_type: "whitelist",
			api_key: myApp.apiKey,
			device_id: "my_device_id",
			user_id: "my_app_user_id"
		};

		let res = await mock(app)
			.post(`/v2/users/`)
			.send(signInData)
			.set("x-request-id", "123");
		const token: ApiAuthToken = res.body.auth;

		await mock(app)
			.delete("/v2/users/me/session")
			.send()
			.set("Authorization", `Bearer ${ token.token }`)
			.expect(204);

		res = await mock(app)
			.post(`/v2/users/`)
			.send(signInData)
			.set("x-request-id", "123");
		const newToken: ApiAuthToken = res.body.auth;
		expect(token.token).not.toEqual(newToken.token);
	});
});
