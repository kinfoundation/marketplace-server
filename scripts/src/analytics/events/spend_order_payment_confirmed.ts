import { Event, EventData } from "../index";
import { Common, create as createCommon } from "./common";

/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Server tracks the OrderID on the blockchain
 */
export interface SpendOrderPaymentConfirmed extends EventData {
	event_name: "spend_order_payment_confirmed";
	event_type: "log";
	common: Common;
	transaction_id: string;
	offer_id: string;
	order_id: string;
	is_native: boolean;
	origin: "marketplace" | "external";
}

export function create(user_id: string, transaction_id: string, offer_id: string, order_id: string, is_native: boolean, origin: "marketplace" | "external"): Event<SpendOrderPaymentConfirmed> {
	return new Event<SpendOrderPaymentConfirmed>({
		event_name: "spend_order_payment_confirmed",
		event_type: "log",
		common: createCommon(user_id),
		transaction_id,
		offer_id,
		order_id,
		is_native,
		origin
	});
}
