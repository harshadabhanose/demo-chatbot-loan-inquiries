'use strict';

var aws = require('aws-sdk');
var ses = new aws.SES({
   region: 'us-east-1'
});

var isPersonalLoan = false;
var isCoborrower = false;
var isOtherLoan = false;

// --------------- Helpers to build responses which match the structure of the necessary dialog actions -----------------------

function elicitSlot(sessionAttributes, intentName, slots, slotToElicit, message, responseCard) {
    return {
        sessionAttributes,
        dialogAction: {
            type: 'ElicitSlot',
            intentName,
            slots,
            slotToElicit,
            message,
            responseCard,
        },
    };
}

function confirmIntent(sessionAttributes, intentName, slots, message, responseCard) {
    return {
        sessionAttributes,
        dialogAction: {
            type: 'ConfirmIntent',
            intentName,
            slots,
            message,
            responseCard,
        },
    };
}

function close(sessionAttributes, fulfillmentState, message, responseCard) {
    return {
        sessionAttributes,
        dialogAction: {
            type: 'Close',
            fulfillmentState,
            message,
            responseCard,
        },
    };
}

function delegate(sessionAttributes, slots) {
    return {
        sessionAttributes,
        dialogAction: {
            type: 'Delegate',
            slots,
        },
    };
}

// Build a responseCard with a title, subtitle, and an optional set of options which should be displayed as buttons.
function buildResponseCard(title, subTitle, options) {
    let buttons = null;
    if (options != null) {
        buttons = [];
        for (let i = 0; i < Math.min(5, options.length); i++) {
            buttons.push(options[i]);
        }
    }
    return {
        contentType: 'application/vnd.amazonaws.card.generic',
        version: 1,
        genericAttachments: [{
            title,
            subTitle,
            buttons,
        }],
    };
}

// ---------------- Helper Functions --------------------------------------------------

function parseLocalDate(date) {
    /**
     * Construct a date object in the local timezone by parsing the input date string, assuming a YYYY-MM-DD format.
     * Note that the Date(dateString) constructor is explicitly avoided as it may implicitly assume a UTC timezone.
     */
    const dateComponents = date.split(/\-/);
    return new Date(dateComponents[2], dateComponents[1] - 1, dateComponents[0]);
}

function isValidDate(date) {
    try {
        return !(isNaN(parseLocalDate(date).getTime()));
    } catch (err) {
        return false;
    }
}

function buildValidationResult(isValid, violatedSlot, messageContent) {
    return {
        isValid,
        violatedSlot,
        message: { contentType: 'PlainText', content: messageContent },
    };
}

function validateLoanEnquiries(loanType, loanAmount, loanTenure, dob, income, profession) {
    const loanTypes = ['personal', 'car'];
    const profTypes = ['salaried', 'professional', 'own business'];
    if (loanType && loanTypes.indexOf(loanType.toLowerCase()) === -1) {
        return buildValidationResult(false, 'LoanType', `We do not offer ${loanType} Loan, are you interested in different type of loan?`);
    }
    if (loanAmount) {
        var amt = loanAmount.replace(/,/g, '');
	    if (amt.match(/[^0-9.-]/))
    		return buildValidationResult(false, 'loanAmount', 'Please enter a valid amount');
    	else {
	    	amt = parseFloat(amt);
		    if (amt < 50000)
			    return buildValidationResult(false, 'loanAmount', 'Loan amount cannot be less than INR 50000. Please enter a valid amount.');
		    else if (amt > 10000000)
			    return buildValidationResult(false, 'loanAmount', 'Loan amount cannot be more than INR 10000000. Please enter a valid amount.');
		}
	}
	if (loanTenure) {
	    var tenure = loanTenure.replace(/[a-zA-Z]/g, '');
	    tenure = tenure.replace(/ /g, '');
	    if (tenure === '' || tenure.match(/[\d]/) === false)
		    return buildValidationResult(false, 'loanTenure', 'Please enter a valid tenure.');
	    else {
		    tenure = parseFloat(tenure);
		    if (tenure < 1)
		        return buildValidationResult(false, 'loanTenure', 'Tenure cannot be less than 1 year');
		    else if (tenure > 7)
			    return buildValidationResult(false, 'loanTenure', 'Tenure cannot be more than 7 years');
		}
	}
    if (dob) {
        if (!isValidDate(dob)) {
            return buildValidationResult(false, 'dob', 'I did not understand that, what is your date of birth?');
        }
        if (parseLocalDate(dob) > new Date()) {
            return buildValidationResult(false, 'dob', 'Date of birth cannot be a future date. Please enter your date of birth.');
        }
    }
    if (income) {
        var amt = income.replace(/,/g, '');
	    if (amt.match(/[^0-9.-]/))
    		return buildValidationResult(false, 'income', 'Please enter a valid income');
    	else {
	    	amt = parseFloat(amt);
            if (amt > 10000000)
			    return buildValidationResult(false, 'income', 'Income cannot be more than INR 10000000. Please enter a valid income.');
		}
	}
	if (profession && profTypes.indexOf(profession.toLowerCase()) === -1) {
        return buildValidationResult(false, 'Profession', `Are you salaried, professional or own business?`);
    }
    return buildValidationResult(true, null, null);
}

// Build a list of potential options for a given slot, to be used in responseCard generation.
function buildOptions(slottype) {
    if (slottype === 'LoanType') {
        return [
            { text: 'Personal Loan', value: 'personal' },
            { text: 'Car Loan', value: 'car' },
        ];
    } else if (slottype === 'Profession') {
        return [
            { text: 'Salaried', value: 'salaried' },
            { text: 'Professional', value: 'professional' },
            { text: 'Own Business', value: 'own business' },
        ];
    }
}

function enquireAboutLoan(intentRequest, callback) {
    const clientName = intentRequest.currentIntent.slots.clientName;
    const clientEmail = intentRequest.currentIntent.slots.clientEmail;
    const clientContactNo = intentRequest.currentIntent.slots.clientContactNo;
    const loanType = intentRequest.currentIntent.slots.loanType;
    const loanAmount = intentRequest.currentIntent.slots.loanAmount;
    const loanTenure = intentRequest.currentIntent.slots.loanTenure;
    const dob = intentRequest.currentIntent.slots.dob;
    const income = intentRequest.currentIntent.slots.income;
    const profession = intentRequest.currentIntent.slots.profession;
    const cobo = intentRequest.currentIntent.slots.loanCobo;
    const coboIncome = intentRequest.currentIntent.slots.coboIncome;
    const otherLoan = intentRequest.currentIntent.slots.otherLoan;
    const monthlyEMI = intentRequest.currentIntent.slots.monthlyEMI;
    const collateral = intentRequest.currentIntent.slots.collateral;
    const existingCustomer = intentRequest.currentIntent.slots.existingCustomer;
    const source = intentRequest.invocationSource;
    const outputSessionAttributes = intentRequest.sessionAttributes || {};

    if (source === 'DialogCodeHook') {
        console.log(`intentRequest: ${JSON.stringify(intentRequest)}`);
        const slots = intentRequest.currentIntent.slots;
        const validationResult = validateLoanEnquiries(loanType, loanAmount, loanTenure, dob, income, profession);
        if (!validationResult.isValid) {
            slots[`${validationResult.violatedSlot}`] = null;
            callback(elicitSlot(intentRequest.sessionAttributes, intentRequest.currentIntent.name, 
                        slots, validationResult.violatedSlot, validationResult.message, 
                        buildResponseCard(`Specify ${validationResult.violatedSlot}`, validationResult.message.content,
                            buildOptions(validationResult.violatedSlot))));
            return;
        }
        if (clientContactNo && !loanType) {
            callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                'loanType', { contentType: 'PlainText', content: 'I can help you to find the best loan offer for you. Which product are you interested from the options below?' },
                buildResponseCard('Specify Loan Type', 'Which product are you interested from the options below?',
                    buildOptions('LoanType'))));
            return;
        }
        if (loanTenure) {
            if ((! isPersonalLoan) && (intentRequest.currentIntent.slots.loanType === 'personal')) {
                console.log(`Loan Type: ${loanType}`);
                callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                    'loanPurpose', { contentType: 'PlainText', content: 'Purpose of the Loan?' }, null));
                    isPersonalLoan = true;
                return;
            } else {
                if (!intentRequest.currentIntent.slots.dob) {
                    callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                        'dob', { contentType: 'PlainText', content: 'Can you also let me know your Date of Birth? (in dd mon yyyy format)' }, null));
                    return;
                }
            }
        }
        if (cobo) {
            if ((! isCoborrower) && (cobo === 'Yes')) {
                console.log(`cobo: ${cobo}`);
                callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                    'coboIncome', { contentType: 'PlainText', content: 'Can you share the monthly income of co-borrower? (INR)' }, null));
                    isCoborrower = true;
                return;
            } else {
                if (!intentRequest.currentIntent.slots.dob) {
                    callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                        'otherLoan', { contentType: 'PlainText', content: 'Great! A few more questions and we will be ready. Are you already paying any EMI?' }, null));
                    return;
                }
            }
        }
        if (otherLoan) {
            if ((! isOtherLoan) && (otherLoan === 'Yes')) {
                console.log(`otherLoan: ${otherLoan}`);
                callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                    'monthlyEMI', { contentType: 'PlainText', content: 'Okay. What is the amount for EMI?' }, null));
                    isOtherLoan = true;
                return;
            } else {
                if (!intentRequest.currentIntent.slots.dob) {
                    callback(elicitSlot(outputSessionAttributes, intentRequest.currentIntent.name, intentRequest.currentIntent.slots, 
                        'collateral', { contentType: 'PlainText', content: 'Are you willing to provide any collateral against the loan?' }, null));
                    return;
                }
            }
        }
        if (intentRequest.currentIntent.confirmationStatus === 'Confirmed') {
            let body = `Dear ${clientName},\n\n
                        Thank you for your interest in loan requirement. Below are the details provided by you:\n
                               Your Name: ${clientName}\n
                               Your Email: ${clientEmail}\n
                               Your Contact Number: ${clientContactNo}\n
                               Type of Loan: ${loanType}\n
                               Loan Amount: ${loanAmount}\n
                               Loan Tenure: ${loanTenure}\n
                               Your Date of Birth: ${dob}\n
                               Your Monthly Income: ${income}\n
                               Your Profession: ${profession}\n
                               Are you willing to have a co-borrower? ${cobo}\n
                               Monthly Income of co-borrower: ${coboIncome}\n
                               Are you already paying any EMI? ${otherLoan}\n
                               Monthly EMI: ${monthlyEMI}\n
                               Are you willing to provide any collateral against the loan? ${collateral}\n
                               Are you an existing customer of the company? ${existingCustomer}\n\n
                               Thanks, your requirement for ${loanType} Loan has been placed. We will get back to you in couple of days.\n
                               bizAmica Software
                               `;
            var eParams = {
                Destination: {
                    ToAddresses: [clientEmail]
                },
                Message: {
                    Body: {
                        Text: {
                            Data: body
                        }
                    },
                    Subject: {
                        Data: "Your loan requirement"
                    }
                },
                Source: "datascience@bizamica.com"
            };
            console.log('===SENDING EMAIL===');
            var email = ses.sendEmail(eParams, function(err, data){
                if(err) console.log(err);
                else {
                    console.log("===EMAIL SENT===");
                    console.log(data);
                    console.log("EMAIL CODE END");
                    console.log('EMAIL: ', email);
                    //context.succeed(event);
                }
            });
            callback(close(outputSessionAttributes, 'Fulfilled', { 
                contentType: 'PlainText', 
                content: `Thanks, your requirement for ${loanType} Loan has been placed. We will get back to you in couple of days`
            }));
            return;
        }
        callback(delegate(outputSessionAttributes, slots));
        return;
    }

    // Order the flowers, and rely on the goodbye message of the bot to define the message to the end user.  In a real bot, this would likely involve a call to a backend service.
    callback(close(outputSessionAttributes, 'Fulfilled', { 
        contentType: 'PlainText', 
        content: `Thanks, your requirement for ${loanType} Loan has been placed. We will get back to you in couple of days`
    }));
}

// --------------- Intents -----------------------

/**
 * Called when the user specifies an intent for this skill.
 */
function dispatch(intentRequest, callback) {
    // console.log(JSON.stringify(intentRequest, null, 2));
    console.log(`dispatch userId=${intentRequest.userId}, intent=${intentRequest.currentIntent.name}`);

    const name = intentRequest.currentIntent.name;

    // Dispatch to your skill's intent handlers
    if (name === 'EnquireAboutLoan') {
        return enquireAboutLoan(intentRequest, callback);
    }
    throw new Error(`Intent with name ${name} not supported`);
}

function loggingCallback(response, originalCallback) {
    // console.log(JSON.stringify(response, null, 2));
    originalCallback(null, response);
}

exports.handler = (event, context, callback) => {
    try {
        console.log(`event.bot.name=${JSON.stringify(context)}`);

        /**
         * Uncomment this if statement and populate with your Lex bot name and / or version as
         * a sanity check to prevent invoking this Lambda function from an undesired Lex bot or
         * bot version.
         */
        /*
        if (event.bot.name !== 'OrderFlowers') {
             callback('Invalid Bot Name');
        }
        */
       dispatch(event, (response) => loggingCallback(response, callback));  
    } catch (err) {
        callback(err);
    }
};