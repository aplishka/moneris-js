'use strict'

// Imports
const xml = require('xml2js')
const request = require('request-promise')
const Promise = require('bluebird');
var $q = require('q');//yes using two promise libraries, but will replace bluebird with q soon.
Promise.promisifyAll(xml)

// Globals (from Moneris PHP API)
const globals = require('./constants/globals.json')

// Intermediaries
const xmlBuilder = new xml.Builder()
xmlBuilder.options.rootName = 'request';

//--
var cleanse = function(str,spaces){
  if(spaces){
    str = String(str).split(' ').join('');
  }
  return (str ? String(str).split('/').join('').split('=').join('').split('*').join('').split('!').join('').split('-').join('').trim() : '');
};
module.exports = function(credentials){
  function send (req, extended) {
    if(extended === undefined) {
      extended = null;
    }
    if (!credentials || !req || !req.type || !credentials.store_id || !credentials.api_token) {
      return Promise.reject(new TypeError('Requires country_code, store_id, api_token'))
    }
    if (credentials.country_code) {
      credentials.country_code = credentials.country_code.toUpperCase()
      if (credentials.country_code !== 'CA' && !globals.hasOwnProperty(credentials.country_code + '_HOST')) {
        return Promise.reject(new TypeError('Invalid country code'))
      }
    }
    let data = {
      store_id: credentials.store_id,
      api_token: credentials.api_token
    }
    if (req.type === 'attribute_query' || req.type === 'session_query') {
      data.risk = {}
      data.risk[req.type] = req
    } else {
      data[req.type] = req
    }
    if (extended) {
      for (let key in extended) {
        if (extended.hasOwnProperty(key) && !data.hasOwnProperty(key)) {
          data[key] = extended[key]
        }
      }
    }
    let prefix = ''
    if (!!credentials.country_code && credentials.country_code !== 'CA') {
      prefix += credentials.country_code + '_'
    }
    let hostPrefix = prefix
    let filePrefix = prefix
    if (credentials.test) {
      hostPrefix += 'TEST_'
    }
    if (req.type === 'acs' || req.type === 'txn') {
      filePrefix += 'MPI_'
    }

    const options = {
      uri: globals.PROTOCOL + '://' + globals[hostPrefix + 'HOST'] + ':' + globals.PORT + globals[filePrefix + 'FILE'],
      method: 'POST',
      body: xmlBuilder.buildObject(data),
      headers: {
        'User-Agent': globals.API_VERSION
      },
      timeout: globals.CLIENT_TIMEOUT * 1000
    }

    return request(options)
          .then(res => xml.parseStringAsync(res))
          .then(res => Array.isArray(res.response.receipt) ? res.response.receipt[0] : res.response.receipt)
  };
  var pay = function(args){
    var pan = cleanse(args.card);
    var expdate = cleanse(args.expiry);
    var amount = cleanse(args.amount);
    var suffix = (new Date()).getTime()+'-'+Math.ceil(Math.random()*10000);
    var order_id = args.order_id || cleanse(credentials.app_name,true)+'-Purchase-'+suffix;
    var cust_id = args.cust_id || 'customer-'+suffix;
    var dynamic_descriptor = args.description || args.dynamic_descriptor || 'purchase';
    if(credentials.test){
      console.log('Order_id (default) format: <APP-NAME>-Purchase-<UNIX-MS-TIME>-<RAND-NUMBER>');
      console.log('Cust_id (default) format: customer-<UNIX-MS-TIME>-<RAND-NUMBER>');
      console.log('Defaulting to order_id: '+order_id);
      console.log('Defaulting to cust_id: '+cust_id);
    }
    var purchase = {
        type: 'purchase',
        cust_id,
        order_id,
        amount,
        pan,
        expdate,
        crypt_type: 7,
        dynamic_descriptor,
        status_check: false
    };
    console.log(purchase);
    return send(purchase)
    .then(function(result){
        var code = result.ResponseCode[0];
        var status = {
            msg: cleanse(result.Message),
            code,
            reference: result.ReferenceNum[0],
            iso: result.ISO[0],
            receipt: result.ReceiptId[0],
            raw: result
        };
        var approved =  (code || code===0 ? parseInt(code)<50 : false );
        return $q.fcall(function(){
            if(approved){
                return status;
            }
            else {
                throw {
                    code: status.code,
                    msg: status.msg
                }
            }
        })
    })
  };
  return { send, pay }
}