// ============================================
//  ENCRYPT / DECRYPT COOKIES
//  So they're safe in a public repo
// ============================================

var crypto = require('crypto');

var ALGORITHM = 'aes-256-gcm';

function encrypt(text, password) {
    var salt = crypto.randomBytes(16);
    var key = crypto.scryptSync(password, salt, 32);
    var iv = crypto.randomBytes(16);
    var cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    var encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    var tag = cipher.getAuthTag();

    return JSON.stringify({
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted
    });
}

function decrypt(encryptedJson, password) {
    var obj = JSON.parse(encryptedJson);
    var salt = Buffer.from(obj.salt, 'hex');
    var iv = Buffer.from(obj.iv, 'hex');
    var tag = Buffer.from(obj.tag, 'hex');
    var key = crypto.scryptSync(password, salt, 32);

    var decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    var decrypted = decipher.update(obj.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = { encrypt: encrypt, decrypt: decrypt };
