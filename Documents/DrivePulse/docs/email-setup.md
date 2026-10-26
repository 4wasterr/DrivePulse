# Account emails on Vercel

DrivePulse sends account verification and password-reset links through Gmail SMTP from the Express backend. Each message goes to the email entered by that client. The sender account does not need to match the recipient. Links open the DrivePulse site that requested them; Vercel deployment URLs are detected automatically.

Set the SMTP variables on the **backend** service in Vercel for Production and, if needed, Preview, then redeploy. Keep credentials out of frontend `VITE_` variables and source control. For local development, use the ignored `backend/.env` and restart the API.

## Configure Gmail SMTP

This uses your existing Gmail account to send low-volume verification and recovery messages to other users. No purchased domain is needed; the website can keep its existing `vercel.app` address.

1. Enable 2-Step Verification on the sending Google account.
2. Create a dedicated **DrivePulse** [Google App Password](https://myaccount.google.com/apppasswords). Google documents the account requirements and availability [here](https://support.google.com/accounts/answer/185833). Use that credential rather than your normal Google password. Enter it directly in Vercel; do not send it through chat.
3. In the Vercel project's backend environment, set:

   ```dotenv
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=your-sending-account@gmail.com
   SMTP_PASS=your-google-app-password
   ```

   Gmail SMTP is always used; there is no provider switch. The host defaults to `smtp.gmail.com` and the port to `465`. The sender defaults to `DrivePulse <SMTP_USER>`. `SMTP_FROM` and `SMTP_REPLY_TO` are optional. Gmail normally uses the authenticated account as the sender.

4. Redeploy after saving the environment variables.

Vercel supports outbound SMTP on ports 465 and 587; DrivePulse awaits delivery before responding and requires TLS. See [Vercel's SMTP guidance](https://vercel.com/kb/guide/serverless-functions-and-smtp).

Gmail is a practical option for a small demo or low-volume app. It has sending limits and may block automated connections from server locations. Google App Passwords are unavailable on some accounts. See [Nodemailer's Gmail guidance](https://nodemailer.com/guides/using-gmail).

## Verify the deployed flow

1. Create a client account with an inbox different from the sender account. Confirm registration asks for email verification and sign-in is blocked until verified.
2. Open the verification email. Its button should open the deployed DrivePulse site and sign in the verified client.
3. Sign out, choose **Forgot password?**, and enter the client's address.
4. Open the reset link, set a new password, and sign in with it. The old password and existing sessions should no longer work; the reset link cannot be reused.

Verification links expire after 24 hours; reset links expire after 30 minutes. Successful sends have a one-minute cooldown. A failed delivery removes the unsent token so the request can be retried immediately. Production registration refuses to create unverified accounts when no mail provider is configured. Local development without any provider still supports demo registration.

Run `npm.cmd run preflight` with the production environment loaded to detect missing SMTP credentials. This validates configuration only; it does not prove SMTP authentication or inbox delivery. The automated email tests use mocked provider responses and do not send real emails.
