import { LoggerInstance } from "winston";

import { lock } from "../../redis";
import * as metrics from "../../metrics";
import * as db from "../../models/orders";
import * as offerDb from "../../models/offers";
import { AssetValue } from "../../models/offers";

import { validateSpendJWT } from "../services/applications";

import { Paging } from "./index";
import * as payment from "./payment";
import * as offerContents from "./offer_contents";

const CREATE_ORDER_RESOURCE_ID = "locks:orders:create";

export interface OrderList {
	orders: Order[];
	paging: Paging;
}

export interface OpenOrder {
	id: string;
	expiration_date: string;
}

export interface Order {
	id: string;
	offer_id: string;
	error?: db.OrderError;
	content?: string; // json serialized payload of the coupon page
	status: db.OrderStatus;
	completion_date: string; // UTC ISO
	title: string;
	description: string;
	amount: number;
	blockchain_data?: offerDb.BlockchainData;
}

export interface MarketplaceOrder extends Order {
	result?: AssetValue;
	call_to_action?: string;
	offer_type: offerDb.OfferType;
}

export interface ExternalOrder extends Order {}

export async function getOrder(orderId: string, logger: LoggerInstance): Promise<Order> {
	const order = await db.Order.getOne(orderId, "!opened");

	if (!order) {
		throw new Error(`no such order ${ orderId } or order is open`); // XXX throw and exception that is convert-able to json
	}

	checkIfTimedOut(order); // no need to wait for the promise

	logger.info("getOne returning", { orderId, status: order.status, offerId: order.offerId, userId: order.userId });
	return orderDbToApi(order);
}

export async function createMarketplaceOrder(offerId: string, userId: string, logger: LoggerInstance): Promise<OpenOrder> {
	logger.info("creating marketplace order for", { offerId, userId });
	const offer = await offerDb.Offer.findOne(offerId);
	if (!offer) {
		throw new Error(`cannot create order, offer ${ offerId } not found`);
	}

	let order = await db.MarketplaceOrder.findOne({
		where: {
			userId,
			offerId,
			status: "opened"
		}
	});

	if (!order) {
		const create = async () => {
			const total = await db.MarketplaceOrder.count({
				where: {
					offerId
				}
			});

			if (total === offer.cap.total) {
				logger.info("total cap reached", { offerId, userId });
				return undefined;
			}

			const forUser = await db.MarketplaceOrder.count({
				where: {
					userId,
					offerId
				}
			});

			if (forUser === offer.cap.per_user) {
				logger.info("per_user cap reached", { offerId, userId });
				return undefined;
			}

			const order = db.MarketplaceOrder.new({
				userId,
				offerId,
				amount: offer.amount,
				type: offer.type,
				status: "opened",
				meta: offer.meta.order_meta
			});
			await order.save();
			return order;
		};

		// order = await lock(createOrderResourceId, create());
		order = await create();
	}

	if (!order) {
		throw new Error(`offer ${ offerId } cap reached`);
	}

	logger.info("created new open marketplace order", { offerId, userId, orderId: order.id });

	return {
		id: order.id,
		expiration_date: order.expirationDate!.toISOString(),
	};
}

export async function createExternalOrder(jwt: string, userId: string, logger: LoggerInstance): Promise<OpenOrder> {
	const offer = await validateSpendJWT(jwt, logger);
	let order = await db.ExternalOrder.findOne({
		where: {
			userId,
			status: "opened",
			offerId: offer.id
		}
	});

	if (!order) {
		order = db.ExternalOrder.new({
			userId,
			offerId: offer.id,
			amount: offer.amount,
			type: "spend", // TODO: we currently only support native spend
			status: "opened",
			meta: {
				title: offer.title,
				description: offer.description,
				wallet_address: offer.wallet_address
			}
		});
		await order.save();
	}

	logger.info("created new open application order", { offerId: offer.id, userId, orderId: order.id });

	return {
		id: order.id,
		expiration_date: order.expirationDate!.toISOString(),
	};
}

export async function submitOrder(
	orderId: string, form: string | undefined, walletAddress: string, appId: string, logger: LoggerInstance): Promise<Order> {

	const order = await db.Order.findOne({ id: orderId });
	if (!order) {
		throw Error(`no such order ${ orderId }`);
	}
	if (order.status !== "opened") {
		return orderDbToApi(order);
	}
	if (new Date() > order.expirationDate!) {
		throw Error(`open order ${ orderId } has expired`);
	}

	const offer = await offerDb.Offer.findOne(order.offerId);
	if (!offer) {
		throw Error(`no such offer ${ order.offerId }`);
	}
	if (offer.type === "earn") {
		// validate form
		if (!await offerContents.isValid(offer.id, form, logger)) {
			throw Error(`submitted form is invalid for ${ order.id }`);
		}
	}

	order.setStatus("pending");
	await order.save();
	logger.info("order changed to pending", { orderId });

	if (offer.type === "earn") {
		await payment.payTo(walletAddress, appId, offer.amount, order.id, logger);
	}

	metrics.submitOrder(offer.type, offer.id);
	return orderDbToApi(order);
}

export async function cancelOrder(orderId: string, logger: LoggerInstance): Promise<void> {
	// you can only delete an open order - not a pending order
	const order = await db.Order.getOne(orderId, "opened");
	if (!order) {
		throw Error(`no such open order ${ orderId }`);
	}

	await order.remove();
}

export async function getOrderHistory(
	userId: string,
	logger: LoggerInstance,
	limit: number = 25,
	before?: string,
	after?: string): Promise<OrderList> {

	// XXX use the cursor input values
	const orders: db.Order[] = await db.Order.getAll(userId, "!opened", limit);

	return {
		orders: orders.map(order => {
			checkIfTimedOut(order); // no need to wait for the promise
			return orderDbToApi(order);
		}),
		paging: {
			cursors: {
				after: "MTAxNTExOTQ1MjAwNzI5NDE",
				before: "NDMyNzQyODI3OTQw",
			},
			previous: "https://api.kinmarketplace.com/v1/orders?limit=25&before=NDMyNzQyODI3OTQw",
			next: "https://api.kinmarketplace.com/v1/orders?limit=25&after=MTAxNTExOTQ1MjAwNzI5NDE=",
		},
	};
}

function orderDbToApi(order: db.ExternalOrder): ExternalOrder;
function orderDbToApi(order: db.MarketplaceOrder): MarketplaceOrder;
function orderDbToApi(order: db.ExternalOrder | db.MarketplaceOrder): ExternalOrder | MarketplaceOrder {
	if (order.status === "opened") {
		throw new Error("opened orders should not be returned");
	}

	const base = {
		id: order.id,
		offer_id: order.offerId,
		status: order.status,
		error: order.error,
		completion_date: (order.currentStatusDate || order.createdDate).toISOString(), // XXX should we separate the dates?
		title: order.meta.title,
		description: order.meta.description,
		amount: order.amount
	};

	return order.isMarketplaceOrder() ?
		Object.assign(base, {
			offer_type: order.type,
			content: order.meta.content,
			blockchain_data: order.blockchainData,
			call_to_action: order.meta.call_to_action,
		}) :
		Object.assign(base, {
			blockchain_data: {
				recipient_address: order.meta.wallet_address
			}
		});
}

function checkIfTimedOut(order: db.Order): Promise<void> {
	if (order.status === "pending" && order.expirationDate! < new Date()) {
		order.setStatus("failed");
		// TODO: add order.error

		return order.save() as any;
	}

	return Promise.resolve();
}
