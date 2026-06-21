require("dotenv").config();

const crypto = require("crypto");
const express = require("express");

const application = express();
const port = Number(process.env.PORT || 3000);
const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
const storefrontUrl = process.env.STOREFRONT_URL || `https://${shopDomain}`;
const proxySecret = process.env.SHOPIFY_APP_PROXY_SECRET || process.env.SHOPIFY_API_SECRET || "";
const signatureVerification = process.env.SIGNATURE_VERIFICATION || "enabled";
const defaultLimit = Number(process.env.RECOMMENDED_PRODUCT_LIMIT || 4);
const fallbackCollectionHandle = process.env.FALLBACK_COLLECTION_HANDLE || "frontpage";
const allowedOriginList = (process.env.ALLOWED_ORIGINS || storefrontUrl)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

application.use(express.json({ limit: "100kb" }));

application.use((request, response, next) => {
  const startedAt = Date.now();

  console.log(JSON.stringify({
    event: "request_started",
    method: request.method,
    path: request.path,
    query: request.query,
    origin: request.headers.origin || null
  }));

  response.on("finish", () => {
    console.log(JSON.stringify({
      event: "request_finished",
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMilliseconds: Date.now() - startedAt
    }));
  });

  next();
});

application.use((request, response, next) => {
  const requestOrigin = request.headers.origin;
  const allowedOrigin = allowedOriginList.includes(requestOrigin) ? requestOrigin : allowedOriginList[0];

  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  next();
});

application.use((request, response, next) =>
  ({
    OPTIONS: () => response.sendStatus(204),
    default: next
  }[request.method] || next)()
);

const createResponse = (success, data) => ({
  success,
  ...data
});

const createStorefrontUrl = (path) =>
  `${storefrontUrl}${path}`;

const fetchStorefrontJson = async (path) => {
  console.log(JSON.stringify({
    event: "shopify_request_started",
    url: createStorefrontUrl(path)
  }));

  const storefrontResponse = await fetch(createStorefrontUrl(path), {
    headers: {
      Accept: "application/json"
    }
  });
  const responseBody = await storefrontResponse.json();

  console.log(JSON.stringify({
    event: "shopify_request_finished",
    url: createStorefrontUrl(path),
    statusCode: storefrontResponse.status
  }));

  return Promise.resolve(responseBody).then((body) =>
    storefrontResponse.ok ? body : Promise.reject(new Error(body.description || body.message || "Shopify request failed"))
  );
};

const normalizeProductIdentifier = (productIdentifier) =>
  String(productIdentifier || "").replace("gid://shopify/Product/", "");

const createProductIdentifierSet = (products) =>
  new Set(
    products
      .map((product) => normalizeProductIdentifier(product.product_id || product.productIdentifier || product.id))
      .filter(Boolean)
  );

const createProductIdentifierList = (products) =>
  products
    .map((product) => normalizeProductIdentifier(product.product_id || product.productIdentifier || product.id))
    .filter(Boolean);

const createProductUrl = (product) =>
  product.url || `/products/${product.handle}`;

const createImageUrl = (product) =>
  product.featured_image || product.image || product.images?.[0] || null;

const mapStorefrontProduct = (product) => ({
  id: normalizeProductIdentifier(product.id),
  title: product.title,
  handle: product.handle,
  url: createProductUrl(product),
  image: createImageUrl(product),
  imageAlternativeText: product.title,
  price: product.price,
  compareAtPrice: product.compare_at_price || null,
  availableForSale: product.available,
  variantIdentifier: (product.variants || []).find((variant) => variant.available)?.id || product.variants?.[0]?.id || null
});

const createUniqueProductList = (products) =>
  Array.from(
    products.reduce((productMap, product) => productMap.set(normalizeProductIdentifier(product.id), product), new Map()).values()
  );

const verifyProxySignature = (queryParameters) => {
  const signature = queryParameters.signature;
  const signedMessage = Object.keys(queryParameters)
    .filter((key) => key !== "signature")
    .sort()
    .map((key) => `${key}=${Array.isArray(queryParameters[key]) ? queryParameters[key].join(",") : queryParameters[key]}`)
    .join("");
  const expectedSignature = crypto.createHmac("sha256", proxySecret).update(signedMessage).digest("hex");
  const providedSignature = Buffer.from(signature || "", "utf8");
  const trustedSignature = Buffer.from(expectedSignature, "utf8");

  return Boolean(proxySecret) && providedSignature.length === trustedSignature.length && crypto.timingSafeEqual(providedSignature, trustedSignature);
};

const trustRequest = (request) =>
  ({
    enabled: () => verifyProxySignature(request.query),
    disabled: () => true
  }[signatureVerification] || (() => verifyProxySignature(request.query)))();

const requireProxySignature = (request, response, next) =>
  ({
    true: next,
    false: () => {
      console.log(JSON.stringify({
        event: "proxy_signature_failed",
        query: request.query,
        signatureVerification
      }));

      return response.status(401).json(createResponse(false, { message: "Invalid app proxy signature" }));
    }
  }[String(trustRequest(request))])();

const parseJsonText = (text) =>
  Promise.resolve(text ? JSON.parse(text) : []);

const parseCartProducts = (request) =>
  parseJsonText(request.query?.products)
    .then((queryProducts) =>
      []
        .concat(request.body?.products || [])
        .concat(request.body?.items || [])
        .concat(queryProducts)
    );

const getRecommendationProducts = (productIdentifier, limit) =>
  fetchStorefrontJson(`/recommendations/products.json?product_id=${encodeURIComponent(productIdentifier)}&limit=${limit}`)
    .then((body) => body.products || []);

const getFallbackProducts = (limit) =>
  fetchStorefrontJson(`/collections/${fallbackCollectionHandle}/products.json?limit=${limit}`)
    .then((body) => body.products || []);

const getCartBasedRecommendations = (cartProducts, limit) => {
  const cartProductIdentifierSet = createProductIdentifierSet(cartProducts);
  const productIdentifierList = createProductIdentifierList(cartProducts);
  const recommendationLimit = limit + cartProductIdentifierSet.size;
  const recommendationRequests = productIdentifierList.map((productIdentifier) =>
    getRecommendationProducts(productIdentifier, recommendationLimit)
  );

  return Promise.all(recommendationRequests)
    .then((recommendationGroups) => recommendationGroups.flat())
    .then(createUniqueProductList)
    .then((products) =>
      products
        .filter((product) => !cartProductIdentifierSet.has(normalizeProductIdentifier(product.id)))
        .slice(0, limit)
    )
    .then((products) =>
      products.length
        ? products
        : getFallbackProducts(recommendationLimit)
            .then(createUniqueProductList)
            .then((fallbackProducts) =>
              fallbackProducts
                .filter((product) => !cartProductIdentifierSet.has(normalizeProductIdentifier(product.id)))
                .slice(0, limit)
            )
    )
    .then((products) => products.map(mapStorefrontProduct));
};

application.get("/health", (request, response) => {
  response.json(createResponse(true, {
    status: "ok",
    shopDomain,
    storefrontUrl
  }));
});

application.post("/recommendations", requireProxySignature, (request, response) => {
  parseCartProducts(request)
    .then((cartProducts) => {
      console.log(JSON.stringify({
        event: "recommendations_requested",
        productCount: cartProducts.length,
        limit: Number(request.body?.limit || request.query?.limit || defaultLimit)
      }));

      return getCartBasedRecommendations(cartProducts, Number(request.body?.limit || request.query?.limit || defaultLimit));
    })
    .then((products) => {
      console.log(JSON.stringify({
        event: "recommendations_created",
        productCount: products.length
      }));

      return response.json(createResponse(true, { products }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        event: "recommendations_failed",
        message: error.message,
        stack: error.stack
      }));

      return response.status(500).json(createResponse(false, { message: error.message }));
    });
});

application.get("/recommendations", requireProxySignature, (request, response) => {
  parseCartProducts(request)
    .then((cartProducts) => {
      console.log(JSON.stringify({
        event: "recommendations_requested",
        productCount: cartProducts.length,
        limit: Number(request.query?.limit || defaultLimit)
      }));

      return getCartBasedRecommendations(cartProducts, Number(request.query?.limit || defaultLimit));
    })
    .then((products) => {
      console.log(JSON.stringify({
        event: "recommendations_created",
        productCount: products.length
      }));

      return response.json(createResponse(true, { products }));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        event: "recommendations_failed",
        message: error.message,
        stack: error.stack
      }));

      return response.status(500).json(createResponse(false, { message: error.message }));
    });
});

application.get("/products", (request, response) => {
  getFallbackProducts(Number(request.query?.limit || defaultLimit))
    .then((products) => response.json(createResponse(true, { products: products.map(mapStorefrontProduct) })))
    .catch((error) => response.status(500).json(createResponse(false, { message: error.message })));
});

application.listen(port, () => {
  console.log(`Recommended products backend running on port ${port}`);
});
