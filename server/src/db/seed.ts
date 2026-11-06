import "dotenv/config";
import { PaymentMethod, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { prisma } from "./client";

// Demo-only credentials. Every seeded account shares this password.
const DEMO_PASSWORD = "Password123!";
const BCRYPT_ROUNDS = 12;

const TUITION_BY_GRADE: Record<string, number> = {
  "Grade 1": 45_000,
  "Grade 2": 48_000,
  "Grade 3": 52_000,
};

const COMMON_FEES = [
  { name: "Activity fee", amountCents: 5_000 },
  { name: "Books & supplies", amountCents: 7_500 },
];

const STUDENTS = [
  { number: "STU-0001", firstName: "Emma", lastName: "Lopez", grade: "Grade 1", parent: 0 },
  { number: "STU-0002", firstName: "Noah", lastName: "Lopez", grade: "Grade 1", parent: 0 },
  { number: "STU-0003", firstName: "Liam", lastName: "Carter", grade: "Grade 1", parent: 1 },
  { number: "STU-0004", firstName: "Ava", lastName: "Patel", grade: "Grade 1", parent: 2 },
  { number: "STU-0005", firstName: "Mia", lastName: "Carter", grade: "Grade 2", parent: 1 },
  { number: "STU-0006", firstName: "Ethan", lastName: "Brooks", grade: "Grade 2", parent: 3 },
  { number: "STU-0007", firstName: "Sophia", lastName: "Patel", grade: "Grade 2", parent: 2 },
  { number: "STU-0008", firstName: "Lucas", lastName: "Brooks", grade: "Grade 2", parent: 3 },
  { number: "STU-0009", firstName: "Isabella", lastName: "Lopez", grade: "Grade 3", parent: 0 },
  { number: "STU-0010", firstName: "Mason", lastName: "Carter", grade: "Grade 3", parent: 1 },
  { number: "STU-0011", firstName: "Amelia", lastName: "Patel", grade: "Grade 3", parent: 2 },
  { number: "STU-0012", firstName: "Logan", lastName: "Brooks", grade: "Grade 3", parent: 3 },
];

type SeedPayment = {
  student: string;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  reference?: string;
  voidReason?: string;
};

// Fall 2026 totals due: Grade 1 = $575.00, Grade 2 = $605.00, Grade 3 = $645.00
const FALL_PAYMENTS: SeedPayment[] = [
  { student: "STU-0001", amountCents: 30_000, method: PaymentMethod.CASH, paidOn: "2026-09-10" },
  {
    student: "STU-0001",
    amountCents: 27_500,
    method: PaymentMethod.BANK_TRANSFER,
    paidOn: "2026-10-05",
    reference: "TRX-88421",
  },
  { student: "STU-0002", amountCents: 20_000, method: PaymentMethod.CARD, paidOn: "2026-09-12" },
  {
    student: "STU-0004",
    amountCents: 57_500,
    method: PaymentMethod.BANK_TRANSFER,
    paidOn: "2026-09-09",
    reference: "TRX-77310",
  },
  { student: "STU-0005", amountCents: 40_000, method: PaymentMethod.CASH, paidOn: "2026-09-15" },
  { student: "STU-0006", amountCents: 60_500, method: PaymentMethod.CARD, paidOn: "2026-09-11" },
  { student: "STU-0008", amountCents: 30_000, method: PaymentMethod.CASH, paidOn: "2026-09-14" },
  {
    student: "STU-0008",
    amountCents: 15_000,
    method: PaymentMethod.CASH,
    paidOn: "2026-09-14",
    voidReason: "Duplicate entry",
  },
  { student: "STU-0008", amountCents: 30_500, method: PaymentMethod.CARD, paidOn: "2026-10-20" },
  {
    student: "STU-0009",
    amountCents: 64_500,
    method: PaymentMethod.CHECK,
    paidOn: "2026-09-08",
    reference: "CHK-1042",
  },
  {
    student: "STU-0010",
    amountCents: 25_000,
    method: PaymentMethod.BANK_TRANSFER,
    paidOn: "2026-10-01",
    reference: "TRX-91002",
  },
  { student: "STU-0012", amountCents: 50_000, method: PaymentMethod.CASH, paidOn: "2026-09-30" },
];

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Seed data error: "${label}" was not found`);
  }
  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing to seed with NODE_ENV=production. Set ALLOW_PRODUCTION_SEED=true.");
  }

  console.log("Resetting tables...");
  await prisma.$executeRaw`TRUNCATE TABLE "payments", "students", "fee_structures", "terms", "classes", "users" RESTART IDENTITY CASCADE`;

  const passwordHash = await hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  const admin = await prisma.user.create({
    data: { email: "admin@demo-school.test", name: "Morgan Reed", role: Role.ADMIN, passwordHash },
  });

  const [teacher1, teacher2] = await Promise.all([
    prisma.user.create({
      data: {
        email: "teacher1@demo-school.test",
        name: "Sarah Mitchell",
        role: Role.TEACHER,
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: "teacher2@demo-school.test",
        name: "David Chen",
        role: Role.TEACHER,
        passwordHash,
      },
    }),
  ]);

  const parentNames = ["Maria Lopez", "James Carter", "Priya Patel", "Daniel Brooks"];
  const parents = await Promise.all(
    parentNames.map((name, index) =>
      prisma.user.create({
        data: {
          email: `parent${index + 1}@demo-school.test`,
          name,
          role: Role.PARENT,
          passwordHash,
        },
      }),
    ),
  );

  const teacherByGrade: Record<string, string> = {
    "Grade 1": teacher1.id,
    "Grade 2": teacher2.id,
    "Grade 3": teacher1.id,
  };
  const classes = await Promise.all(
    Object.entries(teacherByGrade).map(([name, teacherId]) =>
      prisma.schoolClass.create({ data: { name, teacherId } }),
    ),
  );
  const classIdByName = new Map<string, string>(
    classes.map((schoolClass): [string, string] => [schoolClass.name, schoolClass.id]),
  );

  const [fall, spring] = await Promise.all([
    prisma.term.create({
      data: { name: "Fall 2026", startDate: date("2026-09-08"), endDate: date("2026-12-18") },
    }),
    prisma.term.create({
      data: { name: "Spring 2027", startDate: date("2027-01-11"), endDate: date("2027-04-30") },
    }),
  ]);

  const feeRows = classes.flatMap((schoolClass) =>
    [fall, spring].flatMap((term) => [
      {
        classId: schoolClass.id,
        termId: term.id,
        name: "Tuition",
        amountCents: TUITION_BY_GRADE[schoolClass.name],
      },
      ...COMMON_FEES.map((fee) => ({ classId: schoolClass.id, termId: term.id, ...fee })),
    ]),
  );
  await prisma.feeStructure.createMany({ data: feeRows });

  await prisma.student.createMany({
    data: STUDENTS.map((student) => ({
      studentNumber: student.number,
      firstName: student.firstName,
      lastName: student.lastName,
      classId: required(classIdByName.get(student.grade), student.grade),
      parentId: parents[student.parent].id,
    })),
  });

  const students = await prisma.student.findMany();
  const studentIdByNumber = new Map<string, string>(
    students.map((student): [string, string] => [student.studentNumber, student.id]),
  );

  await prisma.payment.createMany({
    data: FALL_PAYMENTS.map((payment) => ({
      studentId: required(studentIdByNumber.get(payment.student), payment.student),
      termId: fall.id,
      amountCents: payment.amountCents,
      method: payment.method,
      reference: payment.reference,
      paidAt: date(payment.paidOn),
      recordedById: admin.id,
      voidedAt: payment.voidReason ? date(payment.paidOn) : null,
      voidReason: payment.voidReason ?? null,
    })),
  });

  console.log("Seed complete:", {
    users: await prisma.user.count(),
    classes: await prisma.schoolClass.count(),
    terms: await prisma.term.count(),
    feeStructures: await prisma.feeStructure.count(),
    students: await prisma.student.count(),
    payments: await prisma.payment.count(),
  });
  console.log(`Demo logins (password: ${DEMO_PASSWORD})`);
  console.log("  admin@demo-school.test, teacher1@demo-school.test, parent1@demo-school.test");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
