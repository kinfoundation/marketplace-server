import { Event, EventData } from "../index";
import { Common, create as createCommon } from "./common";

/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * Server submits spend transaction to blockchain
 */
export interface SpendTransactionBroadcastToBlockchainSubmitted extends EventData {
	event_name: "spend_transaction_broadcast_to_blockchain_submitted";
	event_type: "log";
	common: Common;
	offer_id: string;
	order_id: string;
}

export function create(user_id: string, device_id: string, offer_id: string, order_id: string): Event<SpendTransactionBroadcastToBlockchainSubmitted> {
	return new Event<SpendTransactionBroadcastToBlockchainSubmitted>({
		event_name: "spend_transaction_broadcast_to_blockchain_submitted",
		event_type: "log",
		common: createCommon(user_id, device_id),
		offer_id,
		order_id
	});
}
