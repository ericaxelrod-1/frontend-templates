import { PrivacyPreferences, PrivacyTicket } from '../../features/privacy/privacy.service';

export namespace PrivacyActions {
  export class FetchPreferences {
    static readonly type = '[Privacy UI] Fetch Preferences';
  }

  export class UpdateMarketingConsent {
    static readonly type = '[Privacy UI] Update Marketing Consent';
    constructor(public consent: boolean) {}
  }

  export class UpdateDoNotSell {
    static readonly type = '[Privacy UI] Update Do Not Sell';
    constructor(public doNotSell: boolean) {}
  }

  export class FetchActiveTickets {
    static readonly type = '[Privacy UI] Fetch Active Tickets';
  }

  export class CreateTicket {
    static readonly type = '[Privacy UI] Create Ticket';
    constructor(public requestType: string, public description: string, public additionalData?: Record<string, any>) {}
  }

  export class ExportData {
    static readonly type = '[Privacy UI] Export Data';
  }

  export class DownloadData {
    static readonly type = '[Privacy UI] Download Data';
  }

  export class DeleteAccount {
    static readonly type = '[Privacy UI] Delete Account';
  }

  export class SetPrivacyLoading {
    static readonly type = '[Privacy Store] Set Privacy Loading';
    constructor(public isLoading: boolean) {}
  }

  export class SetPrivacyError {
    static readonly type = '[Privacy Store] Set Privacy Error';
    constructor(public error: string | null) {}
  }
}
