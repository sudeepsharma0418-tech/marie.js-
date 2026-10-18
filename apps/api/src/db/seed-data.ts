import { eq } from 'drizzle-orm';
import type { Db } from './client';
import {
  categories,
  companySettings,
  hotelLocations,
  hotelStockMovements,
  hotels,
  pricingRules,
  products,
  shelfProducts,
  supplierProducts,
  suppliers,
  taxRates,
  units,
  users,
} from './schema';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/** All demo records are flagged is_demo and named "(Demo)". Never mix with real financial records. */
export const DEMO_PASSWORD = 'Demo-Pass-2083!';

const UNITS: [string, string, string][] = [
  ['pcs', 'Piece', 'थान'],
  ['box', 'Box', 'बक्स'],
  ['pack', 'Pack', 'प्याक'],
  ['carton', 'Carton', 'कार्टुन'],
  ['kg', 'Kilogram', 'किलोग्राम'],
  ['g', 'Gram', 'ग्राम'],
  ['ltr', 'Litre', 'लिटर'],
  ['ml', 'Millilitre', 'मिलिलिटर'],
  ['roll', 'Roll', 'रोल'],
  ['set', 'Set', 'सेट'],
  ['dozen', 'Dozen', 'दर्जन'],
  ['bottle', 'Bottle', 'बोतल'],
  ['pair', 'Pair', 'जोडी'],
  ['can', 'Can', 'क्यान'],
];

const CATEGORIES: [string, string, string][] = [
  ['cleaning', 'Cleaning chemicals & tools', 'सफाई रसायन तथा सामग्री'],
  ['paper', 'Tissue, paper & toiletries', 'टिस्यु, कागज तथा शौचालय सामग्री'],
  ['amenities', 'Guest amenities & bathroom', 'पाहुना सुविधा तथा बाथरुम सामग्री'],
  ['linen', 'Bedding, linen & towels', 'ओछ्यान, तन्ना तथा तौलिया'],
  ['fnb', 'Food & beverage supplies', 'खाद्य तथा पेय सामग्री'],
  ['stationery', 'Stationery & office', 'स्टेसनरी तथा कार्यालय सामग्री'],
  ['electrical', 'Electrical, lighting & maintenance', 'बिजुली, बत्ती तथा मर्मत सामग्री'],
  ['kitchen', 'Kitchen equipment & consumables', 'भान्सा उपकरण तथा उपभोग्य सामग्री'],
  ['housekeeping', 'General housekeeping & operations', 'सामान्य हाउसकिपिङ तथा सञ्चालन'],
];

// sku, en, ne, category, unit, purchaseUnit, perPurchase, refCost, tax
const PRODUCTS: [string, string, string, string, string, string, string, string, string][] = [
  [
    'CL-FLR-5L',
    'Floor cleaner 5 L',
    'भुइँ सफा गर्ने झोल ५ लिटर',
    'cleaning',
    'can',
    'carton',
    '4',
    '650.00',
    'VAT13',
  ],
  [
    'CL-GLS-500',
    'Glass cleaner 500 ml',
    'सिसा सफा गर्ने झोल ५०० मिलि',
    'cleaning',
    'bottle',
    'carton',
    '12',
    '180.00',
    'VAT13',
  ],
  [
    'CL-TLT-1L',
    'Toilet bowl cleaner 1 L',
    'शौचालय सफा गर्ने झोल १ लिटर',
    'cleaning',
    'bottle',
    'carton',
    '12',
    '210.00',
    'VAT13',
  ],
  [
    'CL-MOP-01',
    'Cotton mop with handle',
    'ह्यान्डलसहितको कपास मप',
    'cleaning',
    'pcs',
    'pcs',
    '1',
    '420.00',
    'VAT13',
  ],
  [
    'CL-DET-1KG',
    'Laundry detergent powder 1 kg',
    'लुगा धुने पाउडर १ केजी',
    'cleaning',
    'kg',
    'carton',
    '10',
    '195.00',
    'VAT13',
  ],
  [
    'PP-TIS-10',
    'Toilet tissue roll (pack of 10)',
    'ट्वाइलेट टिस्यु रोल (१० वटाको प्याक)',
    'paper',
    'pack',
    'carton',
    '6',
    '380.00',
    'VAT13',
  ],
  [
    'PP-FAC-100',
    'Facial tissue box (100 sheets)',
    'फेसियल टिस्यु बक्स (१०० पाना)',
    'paper',
    'box',
    'carton',
    '24',
    '85.00',
    'VAT13',
  ],
  [
    'PP-NAP-100',
    'Paper napkins (100)',
    'कागजको न्याप्किन (१००)',
    'paper',
    'pack',
    'carton',
    '20',
    '95.00',
    'VAT13',
  ],
  [
    'AM-SHP-30',
    'Guest shampoo 30 ml',
    'पाहुना स्याम्पु ३० मिलि',
    'amenities',
    'pcs',
    'carton',
    '200',
    '14.00',
    'VAT13',
  ],
  [
    'AM-SOP-20',
    'Guest soap 20 g',
    'पाहुना साबुन २० ग्राम',
    'amenities',
    'pcs',
    'carton',
    '250',
    '9.50',
    'VAT13',
  ],
  ['AM-DKT-01', 'Dental kit', 'दन्त किट', 'amenities', 'pcs', 'carton', '200', '18.00', 'VAT13'],
  [
    'AM-SLP-01',
    'Disposable slippers',
    'एकपटक प्रयोग गरिने चप्पल',
    'amenities',
    'pair',
    'carton',
    '100',
    '35.00',
    'VAT13',
  ],
  [
    'LN-BED-SGL',
    'Bedsheet single, white cotton',
    'एकल तन्ना, सेतो कपास',
    'linen',
    'pcs',
    'pcs',
    '1',
    '720.00',
    'VAT13',
  ],
  [
    'LN-BED-DBL',
    'Bedsheet double, white cotton',
    'डबल तन्ना, सेतो कपास',
    'linen',
    'pcs',
    'pcs',
    '1',
    '980.00',
    'VAT13',
  ],
  ['LN-TWL-BTH', 'Bath towel 70x140', 'नुहाउने तौलिया ७०x१४०', 'linen', 'pcs', 'pcs', '1', '560.00', 'VAT13'],
  ['LN-PIL-CVR', 'Pillow cover, white', 'सिरानीको खोल, सेतो', 'linen', 'pcs', 'pcs', '1', '160.00', 'VAT13'],
  ['FB-TEA-500', 'Tea leaves 500 g', 'चियापत्ती ५०० ग्राम', 'fnb', 'pack', 'carton', '20', '310.00', 'VAT13'],
  ['FB-SUG-1KG', 'Sugar 1 kg', 'चिनी १ केजी', 'fnb', 'kg', 'carton', '25', '105.00', 'EXEMPT'],
  ['FB-WTR-1L', 'Drinking water 1 L', 'पिउने पानी १ लिटर', 'fnb', 'bottle', 'carton', '12', '22.00', 'VAT13'],
  [
    'FB-COF-200',
    'Instant coffee 200 g',
    'इन्स्ट्यान्ट कफी २०० ग्राम',
    'fnb',
    'pack',
    'carton',
    '12',
    '520.00',
    'VAT13',
  ],
  [
    'ST-PEN-BLU',
    'Ball pen, blue (box of 50)',
    'बल पेन, निलो (५० को बक्स)',
    'stationery',
    'box',
    'box',
    '1',
    '320.00',
    'VAT13',
  ],
  [
    'ST-A4-500',
    'A4 paper ream 500 sheets',
    'ए४ कागज रिम ५०० पाना',
    'stationery',
    'pack',
    'carton',
    '5',
    '560.00',
    'VAT13',
  ],
  [
    'ST-REG-01',
    'Guest register book',
    'पाहुना दर्ता पुस्तिका',
    'stationery',
    'pcs',
    'pcs',
    '1',
    '250.00',
    'VAT13',
  ],
  ['EL-LED-9W', 'LED bulb 9 W', 'एलइडी बल्ब ९ वाट', 'electrical', 'pcs', 'carton', '50', '115.00', 'VAT13'],
  [
    'EL-TUB-20W',
    'LED tube light 20 W',
    'एलइडी ट्युब लाइट २० वाट',
    'electrical',
    'pcs',
    'carton',
    '25',
    '340.00',
    'VAT13',
  ],
  [
    'EL-EXT-4W',
    'Extension board 4-way',
    'एक्सटेन्सन बोर्ड ४ सकेट',
    'electrical',
    'pcs',
    'pcs',
    '1',
    '480.00',
    'VAT13',
  ],
  [
    'KT-FOIL-72',
    'Aluminium foil roll 72 m',
    'एल्मुनियम फोइल रोल ७२ मिटर',
    'kitchen',
    'roll',
    'carton',
    '12',
    '690.00',
    'VAT13',
  ],
  [
    'KT-GLV-100',
    'Disposable gloves (100)',
    'एकपटक प्रयोग गरिने पन्जा (१००)',
    'kitchen',
    'box',
    'carton',
    '10',
    '410.00',
    'VAT13',
  ],
  [
    'KT-SPG-10',
    'Dish sponge scrubber (10)',
    'भाँडा माझ्ने स्पन्ज (१०)',
    'kitchen',
    'pack',
    'carton',
    '24',
    '120.00',
    'VAT13',
  ],
  [
    'HK-BIN-BAG',
    'Garbage bags large (30)',
    'फोहोर थैली ठूलो (३०)',
    'housekeeping',
    'pack',
    'carton',
    '20',
    '150.00',
    'VAT13',
  ],
  [
    'HK-AIR-300',
    'Air freshener spray 300 ml',
    'एयर फ्रेसनर स्प्रे ३०० मिलि',
    'housekeeping',
    'can',
    'carton',
    '24',
    '260.00',
    'VAT13',
  ],
  [
    'HK-DNC-01',
    '"Do not disturb" door hanger',
    '"बाधा नपुर्‍याउनुहोस्" ढोका ट्याग',
    'housekeeping',
    'pcs',
    'pack',
    '50',
    '25.00',
    'VAT13',
  ],
];

export interface SeedResult {
  ownerId: string;
  userIds: Record<string, string>;
  hotelIds: string[];
  supplierIds: string[];
  productIds: Record<string, string>;
  categoryIds: Record<string, string>;
  shelfTokens: string[];
}

export async function seedDemo(db: Db, opts: { fastHash?: boolean } = {}): Promise<SeedResult> {
  const [existing] = await db.select().from(companySettings).where(eq(companySettings.id, 1));
  if (existing)
    throw new Error('Database already has company settings. Use db:reset for a clean demo database.');

  // Fast hashing is only for automated tests.
  const passwordHash = opts.fastHash
    ? await hash(DEMO_PASSWORD, { memoryCost: 1024, timeCost: 1, parallelism: 1 })
    : await hash(DEMO_PASSWORD);

  return db.transaction(async (tx) => {
    await tx.insert(companySettings).values({
      id: 1,
      legalName: 'Butwal Hotel Supply Pvt. Ltd. (Demo)',
      tradeName: 'HotelProc Butwal (Demo)',
      pan: '000000000',
      vatNumber: null,
      vatRegistered: true,
      address: 'Traffic Chowk, Butwal-11, Rupandehi, Lumbini Province',
      phone: '071-000000',
      email: 'accounts@example.com',
      fiscalYearLabel: '2083/84',
      defaultMarkupPercent: '15.000',
      defaultPaymentTermsDays: 15,
      poApprovalThreshold: '0.00',
      priceOverrideThresholdPercent: '5.000',
      creditOverdueGraceDays: 0,
      writeOffApprovalThreshold: '0.00',
      invoiceTrigger: 'on_delivery',
      invoiceFooter:
        'DEMO DATA – not a valid tax invoice. Tax treatment must be confirmed by a Nepal tax professional.',
    });

    await tx.insert(taxRates).values([
      {
        code: 'VAT13',
        name: 'VAT 13%',
        ratePercent: '13.000',
        requiresVerification: true,
        notes:
          'Standard VAT rate under the VAT Act 2052 as commonly published. Confirm applicability per item with a qualified accountant before go-live.',
      },
      {
        code: 'EXEMPT',
        name: 'VAT exempt',
        ratePercent: '0.000',
        requiresVerification: true,
        notes:
          'For items listed as exempt in the VAT Act schedule. Each product assignment must be confirmed by an accountant.',
      },
    ]);

    await tx.insert(units).values(UNITS.map(([code, nameEn, nameNe]) => ({ code, nameEn, nameNe })));

    const categoryIds: Record<string, string> = {};
    let order = 0;
    for (const [code, nameEn, nameNe] of CATEGORIES) {
      const [c] = await tx
        .insert(categories)
        .values({ code, nameEn, nameNe, sortOrder: order++ })
        .returning();
      categoryIds[code] = c!.id;
    }

    const productIds: Record<string, string> = {};
    for (const [sku, nameEn, nameNe, cat, unit, pUnit, per, cost, tax] of PRODUCTS) {
      const [p] = await tx
        .insert(products)
        .values({
          sku,
          nameEn,
          nameNe,
          categoryId: categoryIds[cat]!,
          sellingUnit: unit,
          purchaseUnit: pUnit,
          unitsPerPurchaseUnit: per,
          referenceCost: cost,
          taxCode: tax,
          isDemo: true,
        })
        .returning();
      productIds[sku] = p!.id;
    }

    const mk = async (
      email: string,
      name: string,
      role: (typeof users.$inferInsert)['role'],
      hotelId: string | null = null,
    ) => {
      const [u] = await tx
        .insert(users)
        .values({ email, name, role, hotelId, passwordHash, isDemo: true })
        .returning();
      return u!.id;
    };
    const userIds: Record<string, string> = {};
    userIds.owner = await mk('owner@demo.local', 'Demo Owner', 'owner');
    userIds.procurement = await mk('procurement@demo.local', 'Sita Procurement (Demo)', 'procurement');
    userIds.warehouse = await mk('hub@demo.local', 'Ram Hub Staff (Demo)', 'warehouse');
    userIds.driver = await mk('driver@demo.local', 'Hari Driver (Demo)', 'driver');

    const hotelRows = [
      {
        code: 'TINAU',
        legalName: 'Tinau View Hotel Pvt. Ltd. (Demo)',
        tradeName: 'Tinau View Hotel',
        hotelType: 'hotel' as const,
        address: 'Milanchowk, Butwal-6',
        creditLimit: '150000.00',
        paymentTermsDays: 15,
        deliveryDays: [0, 3],
        requireManagerApproval: true,
        deliveryInstructions: 'Use the service gate behind the parking lot. Ask for the store keeper.',
      },
      {
        code: 'LUMBG',
        legalName: 'Lumbini Garden Guest House (Demo)',
        tradeName: 'Lumbini Garden',
        hotelType: 'guesthouse' as const,
        address: 'Kalikanagar, Butwal-10',
        creditLimit: '40000.00',
        paymentTermsDays: 7,
        deliveryDays: [2],
        requireManagerApproval: false,
      },
      {
        code: 'HILLR',
        legalName: 'Butwal Hills Resort Pvt. Ltd. (Demo)',
        tradeName: 'Butwal Hills Resort',
        hotelType: 'resort' as const,
        address: 'Charange, Butwal-1',
        creditLimit: '300000.00',
        paymentTermsDays: 30,
        deliveryDays: [1, 4],
        requireManagerApproval: true,
      },
    ];
    const hotelIds: string[] = [];
    for (const h of hotelRows) {
      const [row] = await tx
        .insert(hotels)
        .values({
          ...h,
          city: 'Butwal',
          district: 'Rupandehi',
          phone: '071-000000',
          primaryContactName: 'Front office',
          primaryContactPhone: '98XXXXXXXX',
          accountManagerId: userIds.procurement,
          isDemo: true,
        })
        .returning();
      hotelIds.push(row!.id);
    }
    userIds.tinauManager = await mk(
      'manager@tinau.demo.local',
      'Tinau Manager (Demo)',
      'hotel_manager',
      hotelIds[0]!,
    );
    userIds.tinauPurchaser = await mk(
      'purchase@tinau.demo.local',
      'Tinau Purchaser (Demo)',
      'hotel_purchaser',
      hotelIds[0]!,
    );
    userIds.tinauInventory = await mk(
      'store@tinau.demo.local',
      'Tinau Store Keeper (Demo)',
      'hotel_inventory',
      hotelIds[0]!,
    );
    userIds.lumbiniManager = await mk(
      'manager@lumbini.demo.local',
      'Lumbini Manager (Demo)',
      'hotel_manager',
      hotelIds[1]!,
    );
    userIds.hillsManager = await mk(
      'manager@hills.demo.local',
      'Hills Manager (Demo)',
      'hotel_manager',
      hotelIds[2]!,
    );

    const supplierRows = [
      {
        code: 'SUP-CLEAN',
        name: 'Siddhartha Cleaning Traders (Demo)',
        city: 'Butwal',
        leadTimeDays: 1,
        paymentTermsDays: 15,
        cats: ['cleaning', 'housekeeping', 'kitchen'],
      },
      {
        code: 'SUP-PAPER',
        name: 'Rupandehi Paper House (Demo)',
        city: 'Butwal',
        leadTimeDays: 2,
        paymentTermsDays: 30,
        cats: ['paper', 'stationery'],
      },
      {
        code: 'SUP-LINEN',
        name: 'Bhairahawa Linen Suppliers (Demo)',
        city: 'Bhairahawa',
        leadTimeDays: 3,
        paymentTermsDays: 30,
        cats: ['linen', 'amenities'],
      },
      {
        code: 'SUP-GENRL',
        name: 'Lumbini General Wholesale (Demo)',
        city: 'Butwal',
        leadTimeDays: 1,
        paymentTermsDays: 7,
        cats: ['fnb', 'electrical', 'amenities', 'cleaning'],
      },
    ];
    const supplierIds: string[] = [];
    for (const s of supplierRows) {
      const { cats, ...values } = s;
      const [row] = await tx
        .insert(suppliers)
        .values({ ...values, phone: '071-000000', contactName: 'Sales desk', isDemo: true })
        .returning();
      supplierIds.push(row!.id);
      for (const [sku, , , cat, , , , cost] of PRODUCTS) {
        if (cats.includes(cat))
          await tx
            .insert(supplierProducts)
            .values({ supplierId: row!.id, productId: productIds[sku]!, lastUnitCost: cost })
            .onConflictDoNothing();
      }
    }

    await tx.insert(pricingRules).values([
      {
        scope: 'default',
        ruleType: 'markup_percent',
        value: '15.000',
        reason: 'Demo default markup',
        createdBy: userIds.owner,
      },
      {
        scope: 'category',
        categoryId: categoryIds.linen,
        ruleType: 'markup_percent',
        value: '20.000',
        reason: 'Demo linen markup',
        createdBy: userIds.owner,
      },
      {
        scope: 'category',
        categoryId: categoryIds.fnb,
        ruleType: 'markup_percent',
        value: '8.000',
        reason: 'Demo F&B markup',
        createdBy: userIds.owner,
      },
      {
        scope: 'hotel',
        hotelId: hotelIds[2],
        ruleType: 'markup_percent',
        value: '12.000',
        reason: 'Demo resort volume discount',
        createdBy: userIds.owner,
      },
      {
        scope: 'hotel_product',
        hotelId: hotelIds[0],
        productId: productIds['PP-TIS-10'],
        ruleType: 'fixed_price',
        value: '425.000',
        reason: 'Demo contract price',
        createdBy: userIds.owner,
      },
    ]);

    // Tinau View hotel storage: two areas, three shelves with opening stock
    const area = async (name: string) =>
      (await tx.insert(hotelLocations).values({ hotelId: hotelIds[0]!, kind: 'area', name }).returning())[0]!;
    const shelf = async (name: string, parentId: string) =>
      (
        await tx
          .insert(hotelLocations)
          .values({
            hotelId: hotelIds[0]!,
            kind: 'shelf',
            name,
            parentId,
            qrToken: randomBytes(16).toString('base64url'),
          })
          .returning()
      )[0]!;
    const hk = await area('Housekeeping room');
    const kitchen = await area('Kitchen store');
    const s1 = await shelf('HK shelf A – toiletries', hk.id);
    const s2 = await shelf('HK shelf B – cleaning', hk.id);
    const s3 = await shelf('Kitchen rack 1', kitchen.id);
    const assign = async (loc: string, sku: string, usage: string, min: string, opening: string) => {
      await tx
        .insert(shelfProducts)
        .values({
          hotelId: hotelIds[0]!,
          locationId: loc,
          productId: productIds[sku]!,
          defaultUsageQty: usage,
          minQty: min,
        });
      await tx
        .insert(hotelStockMovements)
        .values({
          hotelId: hotelIds[0]!,
          locationId: loc,
          productId: productIds[sku]!,
          movementType: 'opening',
          quantity: opening,
          actorId: userIds.tinauManager!,
          occurredAt: new Date(),
        });
    };
    await assign(s1.id, 'AM-SHP-30', '2', '40', '120');
    await assign(s1.id, 'AM-SOP-20', '2', '40', '150');
    await assign(s1.id, 'PP-TIS-10', '1', '3', '8');
    await assign(s2.id, 'CL-FLR-5L', '1', '2', '6');
    await assign(s2.id, 'CL-TLT-1L', '1', '4', '10');
    await assign(s3.id, 'KT-GLV-100', '1', '2', '5');
    await assign(s3.id, 'FB-TEA-500', '1', '3', '4');

    return {
      ownerId: userIds.owner!,
      userIds,
      hotelIds,
      supplierIds,
      productIds,
      categoryIds,
      shelfTokens: [s1.qrToken!, s2.qrToken!, s3.qrToken!],
    };
  });
}
