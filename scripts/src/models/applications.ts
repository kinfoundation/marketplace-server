import { generateId, IdPrefix } from "../utils";
import { Column, Entity, Index } from "typeorm";
import { CreationDateModel, Model, register as Register } from "./index";

export type StringMap = { [key: string]: string; };  // key => value pairs

@Entity({ name: "applications" })
@Register
export class Application extends CreationDateModel {
	public static KIK_API_KEY = "A1234567890";  // XXX testing purposes
	public static SAMPLE_API_KEY = "A1111111111";  // XXX testing purposes

	protected static initializers = CreationDateModel.copyInitializers({
		apiKey: () => generateId(IdPrefix.App)
	});

	@Column({ name: "name" })
	public name: string;

	@Column({ name: "api_key" })
	public apiKey: string;

	@Column("simple-json", { name: "jwt_public_keys" })
	public jwtPublicKeys: StringMap;
}

@Entity({ name: "app_whitelists" })
@Index(["appId", "appUserId"], { unique: true })
@Register
export class AppWhitelists extends CreationDateModel {
	@Column({ name: "app_id" })
	public appId: string;

	@Column({ name: "app_user_id" })
	public appUserId: string;

	constructor() {
		super();
	}
}
