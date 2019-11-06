require('isomorphic-fetch');
const next = require('next')
  , dotenv = require('dotenv')
  , Shopify = require('shopify-api-node')
  , express = require('express')
  , compression = require('compression')
  , mobxReact = require('mobx-react')
  , Client = require('shopify-buy')
  , Axios = require('axios')
  , stripe = require('stripe')
  , { get } = require('lodash')
  ;

dotenv.config();
const stripeClient = stripe(process.env.STRIPE_API_KEY);

const port = parseInt(process.env.PORT, 10) || 3000
  , dev = process.env.NODE_ENV !== 'production'
  , app = next({dev, dir: 'src'})
  , handle = app.getRequestHandler()
  ;

const {
  RECHARGE_API_KEY,
  SHOPIFY_API_KEY,
  SHOPIFY_STOREFRONT_KEY,
  SHOPIFY_DOMAIN,
  SHOPIFY_PASSWORD,
} = process.env;

const storefrontClient = Client.buildClient({
  storefrontAccessToken: SHOPIFY_STOREFRONT_KEY,
  domain: SHOPIFY_DOMAIN,
});

const adminClient = Axios.create({
  baseURL: `https://${SHOPIFY_API_KEY}:${SHOPIFY_PASSWORD}@${SHOPIFY_DOMAIN}/admin/api/2019-07`,
  headers: {
    'Accept': 'application/json; charset=utf-8;',
    'Content-Type': 'application/json',
  },
});

const adminAPI = new Shopify({
  shopName: SHOPIFY_DOMAIN,
  apiKey: SHOPIFY_API_KEY,
  apiVersion: '2019-07',
  password: SHOPIFY_PASSWORD,
});

const rechargeClient = Axios.create({
  baseURL: 'https://api.rechargeapps.com/',
  headers: {
    'Accept': 'application/json; charset=utf-8;',
    'Content-Type': 'application/json',
    'X-Recharge-Access-Token': RECHARGE_API_KEY,
  }
});

mobxReact.useStaticRendering(true);

app.prepare().then(() => {
  const server = express();
  server.use(compression());
  server.use(express.json()); // for parsing application/json
  server.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

  server.get('/products/', async (req, res) => {
    const response = await storefrontClient.product.fetchAll();
    return res.send(JSON.stringify(response));
  });

  /* FETCH PRODUCTS */

  server.get('/recharge-products/', async (req, res) => {
    const response = await rechargeClient.get('/products?collection_id=212146');
    return res.send(JSON.stringify(response.data));
  });

  server.get('/shopify-menu-products/', async (req, res) => {
    const response = await adminClient.get('/products.json?product_type=recipe');
    return res.send(JSON.stringify(response.data));
  })

  server.get('/collections/with-products/', async (req, res) => {
    const response = await storefrontClient.collection.fetchAllWithProducts();
    return res.send(JSON.stringify(response));
  });

  /* END FETCH PRODUCTS */

  /* GET CUSTOMER INFO */

  server.get('/recharge-customers/:id', async (req, res) => {
    const response = await rechargeClient.get(`customers?shopify_customer_id=${req.params.id}`);
    return res.end(JSON.stringify(response.data));
  });

  server.get('/recharge-customers/:id/addresses/', async (req, res) => {
    const response = await rechargeClient.get(`customers/${req.params.id}/addresses/`);
    return res.end(JSON.stringify(response.data));
  });

  server.get('/customers/:id/addresses/', async (req, res) => {
    const response = await adminClient.get(`customers/${req.params.id}/addresses.json/`);
    return res.end(JSON.stringify(response.data));
  });

  server.get('/recharge-customers/:stripe_id/payment_sources', async (req, res) => {
    const response = await stripeClient.customers.retrieve(req.params.stripe_id);
    return res.end(JSON.stringify(response));
  });

  /* END GET CUSTOMER INFO */

  /* CREATE CUSTOMERS */

  server.post('/shopify-customers/', async (req, res) => {
    try {
      const response = await adminAPI.customer.create(req.body);
      res.send(JSON.stringify(response));
    }
    catch (e) {
      console.error(e);
      res.status(e.statusCode).json({message: 'Something went wrong! Please check your info and try again!'});
    }
  });

  server.post('/recharge-customers/', async (req, res) => {
    try {
      const response = await rechargeClient.post('customers', req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      return res.status(500).send({message: 'Something went wrong! Please check your info and try again!'});
    }
  });

  server.post('/customers/:id/addresses/', async (req, res) => {
    const response = await rechargeClient.post(`customers/${req.body.customer_id}/addresses/`, req.body);
    return res.end(JSON.stringify(response.data));
  });

  server.put('/customers/:id/', async (req, res) => {
    const response = await rechargeClient.put(`customers/${req.params.id}/`, req.body);
    return res.send(JSON.stringify(response.data));
  });

  server.put('/customers/:customer_id/addresses/:address_id', async (req, res) => {
    try {
      const response = await adminClient.put(`/customers/${req.params.customer_id}/addresses/${req.params.address_id}.json`, req.body);
      return res.send(JSON.stringify(response.data));
    }
    catch (e) {
      return res.status(400).send(e.response.data.errors);
    }
  });

  /* END CREATE CUSTOMERS */

  /* UPDATE CUSTOMER PAYMENT INFO */

  server.put('/customers/:stripe_id/payment-info', async (req, res) => {
    try {
      const { params: { stripe_id }, body: { token, email } } = req
        , source = await stripeClient.sources.create({type: 'card', token: token, owner: {email}})
        ;

      await stripeClient.customers.createSource(stripe_id, {source: source.id});
      await stripeClient.customers.update(stripe_id, {default_source: source.id});

      return res.status(204).send('Success');
    }
    catch (e) {
      console.error(e)
      return res.status(400).json(JSON.stringify(e));
    }
  });

  /* END UPDATE CUSTOMER PAYMENT INFO */

  /* CREATE ORDER */

  server.post('/recharge-customer-info/', async (req, res) => {
    const { shopifyCustomerInfo, rechargeCustomerInfo, metafieldData } = req.body;

    let id = ''
      , isExistingCustomer = false
      , rechargeCustomerResponse = {}
      ;

    try {
      const response = await adminAPI.customer.create(shopifyCustomerInfo);
      id = response.id;
    }
    catch (e) {
      const shopifyCustomers = await adminAPI.customer.list({email: shopifyCustomerInfo.email});
      if (shopifyCustomers.length) {
        id = shopifyCustomers[0].id;
        await adminAPI.customer.update(id, shopifyCustomerInfo);
        isExistingCustomer = true;
      }
    }

    try {
      const rechargeSubmitData = {...rechargeCustomerInfo, shopify_customer_id: id};
      rechargeCustomerResponse = await rechargeClient.post('customers', rechargeSubmitData);
    }
    catch (e) {
      const rechargeCustomers = await rechargeClient.get(`customers?shopify_customer_id=${id}`);
      rechargeCustomerResponse = {data: {customer: {id: rechargeCustomers.data.customers[0].id } } };
    }

    try {
      const rechargeId = rechargeCustomerResponse.data.customer.id;

      metafieldSubmitData = { metafield: { ...metafieldData, owner_id: rechargeId } };
      await rechargeClient.post(`/metafields?owner_resource=customer`, metafieldSubmitData);

      res.end(JSON.stringify({id, rechargeCustomerResponse: rechargeCustomerResponse.data}));
    }
    catch (e) {
      console.error(e);
      res.status(e.statusCode).json({message: e.message});
    }
  });

  server.post('/checkout/', async (req, res) => {
    try {
      const { rechargeCheckoutData, stripeToken } = req.body
        , rechargeCheckoutResponse = await rechargeClient.post('checkouts', rechargeCheckoutData)
        , { checkout: { token } } = rechargeCheckoutResponse.data
        , shippingRates = await rechargeClient.get(`checkouts/${token}/shipping_rates/`)
        ;

      await rechargeClient.put(`checkouts/${token}/`, {
        checkout: {
          shipping_line: {
            handle: get(shippingRates, 'data.shipping_rates[0].handle', 'shopify-Free%20Shipping-0.00'),
          },
        },
      });
      await rechargeClient.post(`checkouts/${token}/charge/`,{
        checkout_charge: { payment_processor: 'stripe', payment_token: stripeToken },
      });

      res.status(200).json({message: 'Success!'});
    }
    catch (e) {
      console.error(e)
      res.status(400).json(e);
    }
  });

  server.post('/recharge-checkouts/', async (req, res) => {
    try {
      const response = await rechargeClient.post('checkouts', req.body);
      return res.end(JSON.stringify(response.data));
    }

    catch (e) {
      console.error(e.response.data.errors)
      res.status(e.statusCode).json({message: e.message});
    }
  });

  server.post('/recharge-charges/:id/', async (req, res) => {
    try {
      const response = await rechargeClient.post(`checkouts/${req.params.id}/charge/`, req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      console.error(e.response.data.errors)
      res.status(e.statusCode).json({message: e.message});
    }
  });

  server.put('/recharge-checkouts/:id/', async (req, res) => {
    try {
      const response = await rechargeClient.put(`checkouts/${req.params.id}/`, req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      console.error(e.response.data.errors)
      res.status(e.statusCode).json({message: e.message});
    }
  });

  server.get('/recharge-checkouts/:token/shipping-rates', async (req, res) => {
    try {
      const response = await rechargeClient.get(`checkouts/${req.params.token}/shipping_rates/`, req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      console.error(e.response.data.errors)
      res.status(e.statusCode).json({message: e.message});
    }
  });

  server.put('/recharge-charges/:id/', async (req, res) => {
    try {
      const response = await rechargeClient.post(`checkouts/${req.params.id}/charge/`, req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      console.error(e.response.data.errors)
      res.status(e.statusCode).json({message: e.message});
    }
  });

  // END CREATE ORDER

  // FETCH CHARGES

  server.get('/recharge-queued-charges/', async (req, res) => {
    const response = await rechargeClient.get(`charges?status=QUEUED&customer_id=${req.query.customer_id}`);
    return res.end(JSON.stringify(response.data));
  });

  // END FETCH CHARGES

  // Skip/Un-skip Charges

  server.post('/skip-charge/:id/', async (req, res) => {
    const response = await rechargeClient.post(`charges/${req.params.id}/skip`, req.body);
    return res.end(JSON.stringify(response.data))
  });

  server.post('/unskip-charge/:id/', async (req, res) => {
    const response = await rechargeClient.post(`charges/${req.params.id}/unskip`, req.body);
    return res.end(JSON.stringify(response.data))
  });

  // END Skip/Un-skip Charges

  // CHANGE ORDER DATE

  server.post('/change-order-date/:orderId', async (req, res) => {
    const response = await rechargeClient.post(`/charges/${req.params.orderId}/change_next_charge_date`, req.body);
    return res.send(JSON.stringify(response.data))
  });

  // END CHANGE ORDER DATE

  // SUBSCRIPTIONS

  server.get('/subscriptions/:id', async (req, res) => {
    const response = await rechargeClient.get(`/subscriptions/${req.params.id}`);
    return res.send(JSON.stringify(response.data))
  });

  server.put('/subscriptions/:id', async (req, res) => {
    try {
      const response = await rechargeClient.put(`/subscriptions/${req.params.id}`, req.body);
      return res.send(JSON.stringify(response.data))
    }
    catch (e) {
      res.json({message: e.response.data.errors});
    }
  });

  server.delete('/subscriptions/:id', async (req, res) => {
    try {
      const response = await rechargeClient.delete(`/subscriptions/${req.params.id}`, req.body);
      return res.send(JSON.stringify(response.data))
    }
    catch (e) {
      res.json({message: e.response.data.errors});
    }
  });

  server.post('/subscriptions', async (req, res) => {
    try {
      const response = await rechargeClient.post('/subscriptions', req.body);
      return res.send(JSON.stringify(response.data))
    }
    catch (e) {
      res.json({message: e.response.data.errors});
    }
  });

  // END UPDATE SUBSCRIPTION

  // ADD ONE-TIME PRODUCT TO ORDER

  server.post('/onetimes/address/:address_id', async (req, res) => {
    try {
      const response = await rechargeClient.post(`/onetimes/address/${req.params.address_id}`, req.body);
      return res.end(JSON.stringify(response.data));
    }
    catch (e) {
      res.json({message: e.response.data.errors});
    }
  });

  server.delete('/onetimes/:id', async (req, res) => {
    try {
      await rechargeClient.delete(`/onetimes/${req.params.id}`);
      return res.end('deleted');
    }
    catch (e) {
      console.error(e)
      res.status(500).json({message: e.message});
    }
  });

  // END ADD ONE-TIME PRODUCT TO ORDER

  // GENERIC //
  // METAFIELDS

  server.post('/recharge-metafields/', async (req, res) => {
    try {
      const response = await rechargeClient.post(`/metafields?owner_resource=customer`, req.body);
      return res.send(JSON.stringify(response.data));
    }
    catch (e) {
      res.json({message: e.message});
    }
  });

  // DISCOUNTS //

  server.get('/discounts/:code', async (req, res) => {
    try {
      const response = await rechargeClient.get(`/discounts?discount_code=${req.params.code}`);
      return res.send(JSON.stringify(response.data));
    }
    catch (e) {
      res.status(400).json(e);
    }
  });

  // END METAFIELDS

  // GENERIC

  server.get('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, async () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
