/**
 * Base application error dengan status code.
 */
export class AppError extends Error {
	public readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(message);
		this.name = "AppError";
		this.statusCode = statusCode;
	}

	get statusMessage(): string {
		switch (this.statusCode) {
			case 400: return "Bad Request";
			case 401: return "Unauthorized";
			case 404: return "Not Found";
			case 502: return "Bad Gateway";
			case 500: return "Internal Server Error";
			case 503: return "Service Unavailable";
			default: return "Error";
		}
	}
}

/** 400 Bad Request */
export class BadRequestError extends AppError {
	constructor(message = "Bad request") {
		super(400, message);
		this.name = "BadRequestError";
	}
}

/** 401 Unauthorized */
export class UnauthorizedError extends AppError {
	constructor(message = "Unauthorized") {
		super(401, message);
		this.name = "UnauthorizedError";
	}
}

/** 503 Service Unavailable */
export class ServiceUnavailableError extends AppError {
	constructor(message = "Service unavailable") {
		super(503, message);
		this.name = "ServiceUnavailableError";
	}
}

/** 404 Not Found */
export class NotFoundError extends AppError {
	constructor(message = "Data not found") {
		super(404, message);
		this.name = "NotFoundError";
	}
}

/** 500 Internal Server Error */
export class InternalError extends AppError {
	constructor(message = "Internal server error") {
		super(500, message);
		this.name = "InternalError";
	}
}

/** 502 Bad Gateway — untuk error scraping */
export class BadGatewayError extends AppError {
	constructor(message = "Failed to fetch from upstream") {
		super(502, message);
		this.name = "BadGatewayError";
	}
}

export class GatewayTimeoutError extends AppError {
	constructor(message = "Upstream did not respond in time") {
		super(504, message);
		this.name = "GatewayTimeoutError";
	}
}
