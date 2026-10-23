import type { Kopecks } from '../money.ts';

/**
 * Налоговые режимы бизнес-контура.
 *
 * Логика заложена для всех, активны только четыре — остальные выключены
 * флагом `active` и не показываются в интерфейсе, пока не понадобятся.
 */
export type RegimeId =
  | 'npd' // НПД (самозанятый)
  | 'usn_income' // УСН «Доходы»
  | 'usn_income_minus_expenses' // УСН «Доходы минус расходы»
  | 'osn_ip_ndfl' // ОСН — ИП (НДФЛ)
  | 'psn' // ПСН (патент) — выключен
  | 'ausn' // АУСН — выключен
  | 'eshn'; // ЕСХН — выключен

export interface RegimeDefinition {
  id: RegimeId;
  /** Название для интерфейса. */
  label: string;
  /** Короткое пояснение — кому подходит. */
  hint: string;
  /** Выключенные режимы объявлены, но недоступны для выбора. */
  active: boolean;
  /** Учитываются ли расходы при расчёте налога. */
  expensesReduceTax: boolean;
  /** Платит ли предприниматель страховые взносы за себя. */
  paysSelfContributions: boolean;
  /** Ставка по умолчанию, %. Для НПД и ОСН не используется — см. расчёт. */
  defaultRatePercent?: number;
  /** Минимальная ставка, до которой регион может снизить налог, %. */
  minRegionalRatePercent?: number;
}

/** Откуда пришёл доход — для НПД ставка зависит от плательщика. */
export type PayerKind = 'individual' | 'business';

export interface TaxInput {
  regime: RegimeId;
  /** Доход от физлиц за период. Для НПД облагается по пониженной ставке. */
  incomeFromIndividuals: Kopecks;
  /** Доход от ИП и организаций за период. */
  incomeFromBusinesses: Kopecks;
  /** Документально подтверждённые расходы, принимаемые к вычету. */
  deductibleExpenses: Kopecks;
  /** Сколько месяцев в году предприниматель состоял на учёте (1..12). */
  monthsRegistered: number;
  /** Остаток бонуса НПД (10 000 ₽ при старте), в копейках. */
  npdBonusRemaining: Kopecks;
  /** Региональная ставка вместо ставки по умолчанию, %. */
  rateOverridePercent?: number;
  /** ОСН: применить профвычет 20% вместо подтверждённых расходов. */
  useProfessionalDeduction?: boolean;
  /** Есть ли сотрудники — влияет на лимит уменьшения налога на взносы. */
  hasEmployees?: boolean;
  /** Прочий доход, уже обложенный НДФЛ (зарплата) — сдвигает ступень шкалы. */
  otherNdflIncome?: Kopecks;
}

export interface BreakdownLine {
  label: string;
  amount: Kopecks;
  /** `true` — строка вычитается из базы или из налога. */
  negative?: boolean;
}

export interface TaxResult {
  regime: RegimeId;
  /** Налоговая база после всех вычетов. */
  taxableBase: Kopecks;
  /** Налог к уплате, округлён до рублей. */
  tax: Kopecks;
  /** Фиксированные страховые взносы за себя. */
  contributionsFixed: Kopecks;
  /** Дополнительный взнос 1% с дохода свыше порога. */
  contributionsOnePercent: Kopecks;
  /** Всего взносов. */
  contributionsTotal: Kopecks;
  /** Налог плюс взносы — реальная нагрузка. */
  totalBurden: Kopecks;
  /** Нагрузка в % от дохода. 0, если дохода нет. */
  effectiveRatePercent: number;
  /**
   * Построчная расшифровка расчёта.
   * Требование фичи «Доступно к трате сегодня»: цифра без раскрытия
   * не вызывает доверия, поэтому расшифровка — часть результата, а не UI.
   */
  breakdown: BreakdownLine[];
  /** Предупреждения: превышение лимитов, непроверенные допущения. */
  warnings: string[];
}

export interface ProgressiveBand {
  /** Верхняя граница ступени по накопленному доходу; null — без границы. */
  upTo: Kopecks | null;
  ratePercent: number;
}

export interface TaxParams {
  /** Год, к которому относятся параметры. */
  year: number;
  /** С какой даты применяются. */
  effectiveFrom: string;

  npd: {
    rateIndividualsPercent: number;
    rateBusinessesPercent: number;
    /** Вычет снижает ставку по доходам от физлиц на столько п.п. */
    bonusDeductionIndividualsPercent: number;
    bonusDeductionBusinessesPercent: number;
    bonusTotal: Kopecks;
    annualIncomeLimit: Kopecks;
  };

  usnIncome: {
    ratePercent: number;
    minRegionalRatePercent: number;
  };

  usnIncomeMinusExpenses: {
    ratePercent: number;
    minRegionalRatePercent: number;
    /** Минимальный налог — процент от доходов. */
    minimumTaxPercent: number;
  };

  osnIp: {
    bands: ProgressiveBand[];
    professionalDeductionPercent: number;
  };

  contributions: {
    /** Фиксированный взнос за полный год. */
    fixedAnnual: Kopecks;
    /** Порог, свыше которого платится 1%. */
    onePercentThreshold: Kopecks;
    onePercentRate: number;
    /** Потолок дополнительного взноса. */
    onePercentCap: Kopecks;
    /** Потолок всех взносов за год. */
    totalCap: Kopecks;
  };

  limits: {
    /** Порог дохода, после которого на УСН возникает НДС. */
    usnVatThreshold: Kopecks;
    /** Лимит дохода для сохранения права на УСН. */
    usnIncomeLimit: Kopecks;
  };
}
