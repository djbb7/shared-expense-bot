'use strict';

const request = require('request-promise');
const aws = require('aws-sdk')
const {google} = require('googleapis');

const parseMessage = (event) => {
  var body = JSON.parse(event.body)

  return Object.assign(event, {body: body})
}

const getGoogleToken = (event) => {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));
  
  return Object.assign(event, {'auth': oAuth2Client});
}

const buildResponse = (event) => {
  var text = event.body.message.text

  // capture 2 groups: (amount) (description)
  var regex = /(\d+(?:\.\d+)?)\s((?:\w+)(?:\s\w+)*)/

  var result = text.match(regex)

  var response = ''

  var expense = ''

  if (result) {
    expense = {
      amount: result[1],
      description: result[2]
    }
  }

  if (text == '/start') {
    response = 'Welcome'
  } else if (text == '/help') {
    response = 'Send messages in format> amount description'
  } else if (expense) {
    response = `${expense.amount} added (${expense.description}) paid by ${event.body.message.from.first_name}`
  } else {
    response = `I didn't understand. Try /help.`
  }

  return Object.assign(event, {response: response, expense: expense})
};

const storeExpense = (event) => {

  if (!event.expense) {
    return event
  }

  const timestamp = new Date().getTime()

  const sheets = google.sheets({version: 'v4', auth: event.auth})

  let row

  if (event.body.message.from.first_name == 'Alexandra') {
    row = [formatDate(event.body.message.date), event.expense.amount, event.expense.amount,0, event.expense.description]
  } else if (event.body.message.from.first_name == 'Daniel') {
    row = [formatDate(event.body.message.date), event.expense.amount, 0, event.expense.amount,event.expense.description]
  }
  return new Promise((resolve, reject) => {
    sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
      resource: {
        majorDimension: 'ROWS',
        values: [
          row
        ]
      }
    }, (err, {data}) => {
      if (err) reject(err)
      resolve(Object.assign(event, {data: data}))
    });
  })
}


const getTotalDebt = (event) => {
  const sheets = google.sheets({version: 'v4', auth: event.auth})

  return new Promise((resolve, reject) => {
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!G5:H6'
    }, (err, {data}) => {
      if (err) reject(err)

      let balanceDaniel = parseFloat(data.values[0][1])
      let balanceAlex = parseFloat(data.values[1][1])

      if (balanceDaniel < 0) {
        event.response += '. '+data.values[1][0]+' '+data.values[1][1]
      } else {
        event.response += '. '+data.values[0][0]+' '+data.values[0][1]
      }
      resolve(Object.assign(event, {balance: data.values}))
    })
  })

}

const sendMessage = (event) => {

  console.log('Inside send message')
  var chatId = event.body.message.chat.id

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`

  var body = {
    chat_id: chatId,
    text: event.response
  }

  var options = {
    method: 'POST',
    uri: url,
    body: body,
    json: true
  }

  return request(options)
};

const successResponse = callback => callback(null, {
  statusCode: 200
})

const errorResponse = (error, callback) => {
  console.log('Error', error)
  return callback(null, {
    statusCode: 500
  })
}

const formatDate = (timestamp) => {
  const date = new Date(timestamp*1000)

  return date.getDate()+'/'+date.getMonth()+'/'+date.getFullYear()
}

module.exports.hello = (event, context, callback) =>
  Promise.resolve(event)
    .then(parseMessage)
    .then(buildResponse)
    .then(getGoogleToken)
    .then(storeExpense)
    .then(getTotalDebt)
    .then(sendMessage)
    .then(() => successResponse(callback))
    .catch(error => errorResponse(error, callback))
