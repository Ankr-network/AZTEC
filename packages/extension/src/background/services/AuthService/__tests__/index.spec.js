import {
    spy,
} from 'sinon';
import crypto from 'crypto';
import * as storage from '~utils/storage';
import {
    permissionError,
} from '~utils/error';
import AuthService from '..';

jest.mock('~utils/storage');

Object.defineProperty(global.self, 'crypto', {
    value: {
        getRandomValues: arr => crypto.randomBytes(arr.length),
    },
});

const encryptedKeyStore = {
    encSeed: {
        encStr: 'shOAQEt32dkSh36RfFIjZc5FF6/vGoLDZ1dLF9DrhRhqfnRuaglhEwgY7FGyDB2w851Q5+zRRz6rbi3chu85e+5nTtIXypmsy+EmzubvR5JBeJGwjLKn3klUrepjE5UpwnHmyKIf/Oi88Op7kd51CvWV1sIE/BoyXjUdj/hq0HprEM118pwcUw==',
        nonce: 'sCdtnErzAqu+pDKBfXjsgVdwMimOkbiP',
    },
    encHdRootPriv: {
        encStr: 'frX+nForl8AIAohTDK0aNuM7CYHk8Ykm3xFyqhPdyr5uUiuc3dKC8vsAG6hWCWQj3y6URpjYB4LdKiuN/BCXaCw0CcR2l1Dsf7Gxi5O8FFbZv21zNJ2S9BmU8amQMA21M52gaWDf/Bdp6zUa60HsOTEV7ZP5WMAm/NXzyIaLjQ==',
        nonce: 'p+tHVMGQReDwvwcaErNirehT5mJsdNqi',
    },
    hdPathString: "m/0'/0'/0'",
    salt: 'strangeSalt',
    hdIndex: 1,
    privacyKeys: {
        publicKey: 'z7kvlspK+/9b/7+zzJwIJ3qjd76LFBZVDWmUxlD6QU0=',
        encPrivKey: {
            encStr: '/Vt6N1Z0w1iMId+eKkTjycdJDKC8x8pk/cZBVjw4thYJJe37AYoPRiHqaJvKMldeixS8NHhFlfcJ20Lxz1LbsRICW61q436o4INbZnQuuVE=',
            nonce: 'KdbKscduwHL9y1vJRi1ncLt4cBZ/S8Se',
        },
    },
};

describe.only('Auth Service Tests', () => {
    let set;
    let get;
    let remove;
    beforeEach(() => {
        set = spy(storage, 'set');
        get = spy(storage, 'get');
        remove = spy(storage, 'remove');
        set({ keyStore: encryptedKeyStore });
    });

    afterEach(() => {
        set.restore();
        get.restore();
        remove.restore();
        storage.reset();
    });


    it('Should create a session if the supplied password can decrypt the stored keystore', async () => {
        const session = await AuthService.login({
            password: 'password',
            domain: 'https://google.com',
        });
        expect(session).toBeDefined();
    });

    it('should add the domain to the list of domains that can decrypt an assets balance', async () => {
        const domain = {
            password: 'password',
            domain: 'https://google.com',
            asset: '__asset_id_0',
        };
        const session = await AuthService.enableAssetForDomain(domain);
        expect(session.assets[domain.asset]).toEqual(true);
    });


    it('Should validate the session is currently active and the user has granted the domain access to the asset', async () => {
        await AuthService.login({
            password: 'password',
            domain: 'https://google.com',
        });
        await AuthService.enableAssetForDomain({
            password: 'password',
            domain: 'https://google.com',
            asset: '__asset_id_0',
        });
        const session = await AuthService.validateSession();
        await AuthService.validateDomainAccess({
            domain: 'https://google.com',
            asset: '__asset_id_0',
        });

        expect(session).toBeDefined();
    });

    it('Should not validate the session if the last session activity is > 7 days ago', async () => {
        await AuthService.login({
            password: 'password',
            domain: 'https://google.com',
        });

        await set({
            session: {
                lastActive: Date.now() - (8 * 24 * 60 * 60 * 1000),
                createdAt: Date.now(),
            },
        });
        await expect(AuthService.validateSession()).rejects.toThrow('The session is no longer active please login');
        expect(remove.called);
    });

    it('Should not validate the session if the session age is 21 days ago', async () => {
        await AuthService.login({
            password: 'password',
            domain: 'https://google.com',
        });
        await set({
            session: {
                createdAt: Date.now() - (22 * 24 * 60 * 60 * 1000),
                lastActive: Date.now(),
            },
        });
        await expect(AuthService.validateSession()).rejects.toThrow('The session is > 21 days old please login');
        expect(remove.called);
    });

    it('Should not validate the session if the user has not granted the domain access to the asset ', async () => {
        await AuthService.login({
            password: 'password',
            domain: 'https://google.com',
        });
        const resp = await AuthService.validateDomainAccess({
            domain: 'https://google.com',
            asset: '__asset_id_0',
        });
        expect(resp).toEqual(permissionError('domain.not.grantedAccess.asset', {
            messageOptions: {
                domain: 'https://google.com',
                asset: '__asset_id_0',
            },
        }));
    });


    it('should create the keystore if supplied a password and a salt', async () => {
        const { publicKey } = await AuthService.registerExtension({
            password: 'password',
            salt: 'saltypretzel',
        });
        expect(publicKey);
        expect(set.called);
    });
});