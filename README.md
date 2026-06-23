# Recommended Products Backend

A Node.js/Express backend server that provides Shopify product recommendation APIs. This service integrates with Shopify's Storefront API to deliver personalized product recommendations based on cart contents, with fallback support for default collections.

## Features

- **Cart-based recommendations**: Generates product recommendations based on items in the shopping cart
- **Shopify integration**: Uses Shopify's Storefront API for fetching product data and recommendations
- **Signature verification**: Supports Shopify app proxy signature verification for secure requests
- **CORS support**: Configurable cross-origin resource sharing for frontend integration
- **Fallback mechanism**: Automatically falls back to default collection when recommendations are unavailable
- **Structured logging**: JSON-formatted logs for request tracking and debugging
- **Health check endpoint**: Monitor service status and configuration

## Installation

### Prerequisites

- Node.js 24.x
- npm or yarn
- Shopify store with Storefront API access

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd ma-recommend-products-
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with the required environment variables (see Configuration below).

4. Start the server:
```bash
npm start
```

The server will start on the port specified in the `PORT` environment variable (default: 3000).

## Configuration

Create a `.env` file with the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Port number for the server to listen on |
| `SHOPIFY_SHOP_DOMAIN` | Yes | - | Your Shopify store domain (e.g., `mystore.myshopify.com`) |
| `STOREFRONT_URL` | No | `https://<SHOPIFY_SHOP_DOMAIN>` | Custom storefront URL for API requests |
| `SHOPIFY_APP_PROXY_SECRET` | No* | - | Shopify app proxy secret for signature verification |
| `SHOPIFY_API_SECRET` | No* | - | Fallback to `SHOPIFY_APP_PROXY_SECRET` if not set |
| `SIGNATURE_VERIFICATION` | No | enabled | Enable/disable signature verification (`enabled`/`disabled`) |
| `RECOMMENDED_PRODUCT_LIMIT` | No | 4 | Default number of products to return in recommendations |
| `FALLBACK_COLLECTION_HANDLE` | No | frontpage | Collection handle to use as fallback when recommendations are unavailable |
| `ALLOWED_ORIGINS` | No | `<STOREFRONT_URL>` | Comma-separated list of allowed CORS origins |

*Required if `SIGNATURE_VERIFICATION` is enabled (default)

### Example .env file

```env
PORT=3000
SHOPIFY_SHOP_DOMAIN=mystore.myshopify.com
STOREFRONT_URL=https://mystore.myshopify.com
SHOPIFY_APP_PROXY_SECRET=your_proxy_secret_here
SIGNATURE_VERIFICATION=enabled
RECOMMENDED_PRODUCT_LIMIT=4
FALLBACK_COLLECTION_HANDLE=frontpage
ALLOWED_ORIGINS=https://mystore.myshopify.com,https://mystore.com
```

## API Endpoints

### Health Check

Check server status and configuration.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "success": true,
  "status": "ok",
  "shopDomain": "mystore.myshopify.com",
  "storefrontUrl": "https://mystore.myshopify.com"
}
```

### Get Recommendations (POST)

Get product recommendations based on cart products.

**Endpoint:** `POST /recommendations`

**Headers:**
- `Content-Type: application/json`

**Query Parameters:**
- `signature` (required if signature verification enabled): Shopify app proxy signature
- `limit` (optional): Number of recommendations to return (default: 4)
- `products` (optional): JSON stringified array of cart products

**Request Body:**
```json
{
  "products": [
    {
      "product_id": "123456789",
      "id": "gid://shopify/Product/123456789"
    }
  ],
  "limit": 4
}
```

**Response:**
```json
{
  "success": true,
  "products": [
    {
      "id": "987654321",
      "title": "Product Name",
      "handle": "product-handle",
      "url": "/products/product-handle",
      "image": "https://cdn.shopify.com/...",
      "imageAlternativeText": "Product Name",
      "price": "29.99",
      "compareAtPrice": "39.99",
      "availableForSale": true,
      "variantIdentifier": "gid://shopify/ProductVariant/123"
    }
  ]
}
```

### Get Recommendations (GET)

Get product recommendations based on cart products (GET method).

**Endpoint:** `GET /recommendations`

**Query Parameters:**
- `signature` (required if signature verification enabled): Shopify app proxy signature
- `limit` (optional): Number of recommendations to return (default: 4)
- `products` (optional): JSON stringified array of cart products

**Response:** Same as POST endpoint

### Get Products (Fallback)

Get products from the fallback collection.

**Endpoint:** `GET /products`

**Query Parameters:**
- `limit` (optional): Number of products to return (default: 4)

**Response:**
```json
{
  "success": true,
  "products": [...]
}
```

## Product Identifier Formats

The API accepts product identifiers in multiple formats:

- Numeric ID: `123456789`
- Shopify GID: `gid://shopify/Product/123456789`
- Custom identifier: `product_id` field in request body

All identifiers are normalized internally to numeric IDs for processing.

## Recommendation Logic

1. **Parse cart products**: Extracts product identifiers from request body or query parameters
2. **Fetch recommendations**: Calls Shopify's recommendation API for each cart product
3. **Deduplicate products**: Removes duplicate recommendations across all products
4. **Filter cart items**: Excludes products already in the cart from recommendations
5. **Apply limit**: Returns up to the specified number of recommendations
6. **Fallback mechanism**: If no recommendations found, fetches products from the fallback collection
7. **Normalize response**: Maps Shopify product data to a consistent format

## Signature Verification

When `SIGNATURE_VERIFICATION` is enabled, the server verifies Shopify app proxy signatures using HMAC-SHA256. This ensures requests originate from your Shopify app.

The verification process:
1. Extracts the `signature` query parameter
2. Constructs a signed message from all other query parameters (sorted alphabetically)
3. Computes HMAC-SHA256 hash using the proxy secret
4. Compares the computed hash with the provided signature using timing-safe comparison

**Disable signature verification** for development or testing by setting:
```env
SIGNATURE_VERIFICATION=disabled
```

## CORS Configuration

The server supports CORS for cross-origin requests from your storefront. Configure allowed origins using the `ALLOWED_ORIGINS` environment variable.

If the request origin is in the allowed list, that origin is used in the `Access-Control-Allow-Origin` header. Otherwise, the first origin in the list is used.

## Logging

The server outputs structured JSON logs for monitoring and debugging:

- `request_started`: Logs incoming request details
- `request_finished`: Logs request completion with duration
- `shopify_request_started`: Logs Shopify API request initiation
- `shopify_request_finished`: Logs Shopify API response
- `recommendations_requested`: Logs recommendation request details
- `recommendations_created`: Logs successful recommendation generation
- `recommendations_failed`: Logs recommendation errors
- `proxy_signature_failed`: Logs signature verification failures

## Error Handling

The API returns standardized error responses:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common error scenarios:
- **401 Unauthorized**: Invalid or missing proxy signature
- **500 Internal Server Error**: Shopify API failures or server errors

## Development

### Scripts

- `npm start`: Start the production server
- `npm run development`: Start the development server (same as start)

### Testing Locally

1. Set up your `.env` file with your Shopify store credentials
2. Disable signature verification for local testing:
   ```env
   SIGNATURE_VERIFICATION=disabled
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Test endpoints using curl or Postman:
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/products?limit=4
   ```

## Deployment

### Requirements

- Node.js 24.x runtime environment
- Environment variables configured
- Shopify store with accessible Storefront API

### Platform-Specific Notes

- **Heroku**: Ensure the `PORT` environment variable is not set (Heroku assigns it dynamically)
- **Vercel/Netlify**: May require adapter configuration for serverless deployment
- **Docker**: Include a `Dockerfile` for containerized deployment

### Production Considerations

- Enable signature verification in production
- Use environment-specific configuration
- Implement proper logging aggregation
- Set up monitoring for the health endpoint
- Configure rate limiting if needed
- Use HTTPS for all API communications

## Troubleshooting

### Recommendations return empty array

- Verify your Shopify store has recommendation data
- Check that product identifiers are valid
- Ensure the fallback collection exists and has products
- Review Shopify API logs for errors

### Signature verification fails

- Verify `SHOPIFY_APP_PROXY_SECRET` matches your Shopify app configuration
- Ensure the signature is being passed correctly in query parameters
- Check that query parameters are properly encoded
- Disable verification temporarily to isolate the issue

### CORS errors

- Verify your origin is in the `ALLOWED_ORIGINS` list
- Check that the origin is passed correctly in request headers
- Ensure the storefront URL is accessible


