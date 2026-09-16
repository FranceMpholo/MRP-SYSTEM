const express = require("express");
const router = express.Router();
const postgres = require("../postgres");


const PLANNING_STATUSES = [
  "Planned",
  "In progress",
  "Completed",
  "Blocked",
  "Changeover",
  "OFF",
];

function isValidPlanningStatus(status) {
  return PLANNING_STATUSES.includes(status);
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_STRING_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function isValidDateOnly(value) {
  if (typeof value !== "string") return false;

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function toDateOnlyString(value) {
  if (typeof value === "string") return value;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return "";

  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseNonNegativeNumber(value) {
  const isNumber = typeof value === "number";
  const isNumericString =
    typeof value === "string" &&
    value.trim() !== "" &&
    NUMERIC_STRING_PATTERN.test(value.trim());

  if (!isNumber && !isNumericString) return { valid: false };

  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? { valid: true, value: number }
    : { valid: false };
}

router.get("/health", async (_request, response) => {
  try {
    const rows = await postgres.query(
      "SELECT current_database(), current_user, NOW() AS server_time"
    );

    response.json({
      success: true,
      service: "mrp-postgres-api",
      database: rows[0],
    });
  } catch (error) {
    console.error("PostgreSQL health check failed:", error);

    response.status(500).json({
      success: false,
      error: "PostgreSQL connection failed",
    });
  }
});
router.get("/departments", async (_request, response) => {
  try {
    const rows = await postgres.query(`
      SELECT id, code, name, is_active
      FROM departments
      ORDER BY code
    `);

    response.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to load departments:", error);

    response.status(500).json({
      success: false,
      error: "Failed to load departments",
    });
  }
});
router.get("/shifts", async (_request, response) => {
  try {
    const rows = await postgres.query(`
      SELECT
        s.id,
        s.department_id,
        d.code AS department_code,
        d.name AS department_name,
        s.code,
        s.name,
        s.start_time,
        s.end_time,
        s.is_active
      FROM shifts s
      LEFT JOIN departments d
        ON s.department_id = d.id
      ORDER BY d.code, s.start_time
    `);

    response.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to load shifts:", error);

    response.status(500).json({
      success: false,
      error: "Failed to load shifts",
    });
  }
});
router.get("/machines", async (_request, response) => {
  try {
    const rows = await postgres.query(`
      SELECT
        m.id,
        m.department_id,
        d.code AS department_code,
        d.name AS department_name,
        m.code,
        m.name,
        m.machine_type,
        m.is_active
      FROM machines m
      LEFT JOIN departments d
        ON m.department_id = d.id
      ORDER BY d.code, m.code
    `);

    response.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to load machines:", error);

    response.status(500).json({
      success: false,
      error: "Failed to load machines",
    });
  }
});
router.get("/planning", async (_request, response) => {
  try {
    const rows = await postgres.query(`
      SELECT
        p.id,
        p.production_date,
        p.week_start,
        p.planned_qty,
        p.changeover_qty,
        p.status,

        p.department_id,
        d.code AS department_code,
        d.name AS department_name,

        p.machine_id,
        m.code AS machine_code,
        m.name AS machine_name,

        p.shift_id,
        s.code AS shift_code,
        s.name AS shift_name,
        s.start_time,
        s.end_time,

        p.parent_item_id,
        i.stock_code AS parent_stock_code,
        i.description AS parent_description,

        p.supervisor_user_id,
        su.username AS supervisor_username,
        su.full_name AS supervisor_name,

        p.created_by,
        cu.username AS created_by_username,
        cu.full_name AS created_by_name,

        p.created_at,
        p.updated_at

      FROM planning_entries p

      JOIN departments d
        ON p.department_id = d.id

      LEFT JOIN machines m
        ON p.machine_id = m.id

      JOIN shifts s
        ON p.shift_id = s.id

      JOIN items i
        ON p.parent_item_id = i.id

      LEFT JOIN users su
        ON p.supervisor_user_id = su.id

      LEFT JOIN users cu
        ON p.created_by = cu.id

      ORDER BY
        p.production_date DESC,
        s.start_time,
        d.code,
        m.code
    `);

    response.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to load planning entries:", error);

    response.status(500).json({
      success: false,
      error: "Failed to load planning entries",
    });
  }
});
router.post("/planning", async (request, response) => {
  try {
    const {
      department_id,
      machine_id = null,
      shift_id,
      parent_item_id,
      production_date,
      week_start,
      planned_qty,
      changeover_qty = 0,
      status = "Planned",
      supervisor_user_id = null,
      created_by = null,
    } = request.body || {};

    const errors = [];

    // Required fields
    if (!department_id) errors.push("department_id is required");
    if (!shift_id) errors.push("shift_id is required");
    if (!parent_item_id) errors.push("parent_item_id is required");
    if (!production_date) errors.push("production_date is required");
    if (!week_start) errors.push("week_start is required");

    if (
      planned_qty === undefined ||
      planned_qty === null ||
      planned_qty === ""
    ) {
      errors.push("planned_qty is required");
    }

    // UUID validation
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const uuidFields = {
      department_id,
      machine_id,
      shift_id,
      parent_item_id,
      supervisor_user_id,
      created_by,
    };

    for (const [field, value] of Object.entries(uuidFields)) {
      if (value !== null && value !== undefined && value !== "") {
        if (!uuidPattern.test(String(value))) {
          errors.push(`${field} must be a valid UUID`);
        }
      }
    }

    if (
      production_date &&
      !isValidDateOnly(production_date)
    ) {
      errors.push("production_date must use YYYY-MM-DD");
    }

    if (
      week_start &&
      !isValidDateOnly(week_start)
    ) {
      errors.push("week_start must use YYYY-MM-DD");
    }

    // Quantity validation
    const plannedQtyResult = parseNonNegativeNumber(planned_qty);
    const changeoverQtyResult = parseNonNegativeNumber(changeover_qty);

    if (
      planned_qty !== undefined &&
      planned_qty !== null &&
      planned_qty !== "" &&
      !plannedQtyResult.valid
    ) {
      errors.push("planned_qty must be a non-negative number");
    }

    if (!changeoverQtyResult.valid) {
      errors.push("changeover_qty must be a non-negative number");
    }
    if (!isValidPlanningStatus(status)) {
      errors.push(
        `status must be one of: ${PLANNING_STATUSES.join(", ")}`
      );
    }
    if (errors.length > 0) {
      return response.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      });
    }

    // Foreign-key validation
    const departmentRows = await postgres.query(
      `SELECT id, is_active
       FROM departments
       WHERE id = $1`,
      [department_id]
    );

    if (departmentRows.length === 0) {
      errors.push("department_id does not exist");
    } else if (!departmentRows[0].is_active) {
      errors.push("department_id is inactive");
    }

    const shiftRows = await postgres.query(
      `SELECT id, department_id, is_active
       FROM shifts
       WHERE id = $1`,
      [shift_id]
    );

    if (shiftRows.length === 0) {
      errors.push("shift_id does not exist");
    } else {
      if (!shiftRows[0].is_active) {
        errors.push("shift_id is inactive");
      }
      if (String(shiftRows[0].department_id) !== String(department_id)) {
        errors.push("shift_id does not belong to department_id");
      }
    }

    const itemRows = await postgres.query(
      `SELECT id, is_active
       FROM items
       WHERE id = $1`,
      [parent_item_id]
    );

    if (itemRows.length === 0) {
      errors.push("parent_item_id does not exist");
    } else if (!itemRows[0].is_active) {
      errors.push("parent_item_id is inactive");
    }

    if (machine_id) {
      const machineRows = await postgres.query(
        `SELECT id, department_id, is_active
         FROM machines
         WHERE id = $1`,
        [machine_id]
      );

      if (machineRows.length === 0) {
        errors.push("machine_id does not exist");
      } else {
        if (!machineRows[0].is_active) {
          errors.push("machine_id is inactive");
        }
        if (String(machineRows[0].department_id) !== String(department_id)) {
          errors.push("machine_id does not belong to department_id");
        }
      }
    }

    if (supervisor_user_id) {
      const supervisorRows = await postgres.query(
        `SELECT id
         FROM users
         WHERE id = $1`,
        [supervisor_user_id]
      );

      if (supervisorRows.length === 0) {
        errors.push("supervisor_user_id does not exist");
      }
    }

    if (created_by) {
      const creatorRows = await postgres.query(
        `SELECT id
         FROM users
         WHERE id = $1`,
        [created_by]
      );

      if (creatorRows.length === 0) {
        errors.push("created_by does not exist");
      }
    }

    if (errors.length > 0) {
      return response.status(400).json({
        success: false,
        error: "Foreign-key validation failed",
        details: errors,
      });
    }

    const rows = await postgres.query(
      `
      INSERT INTO planning_entries (
        department_id,
        machine_id,
        shift_id,
        parent_item_id,
        production_date,
        week_start,
        planned_qty,
        changeover_qty,
        status,
        supervisor_user_id,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11
      )
      RETURNING *
      `,
      [
        department_id,
        machine_id || null,
        shift_id,
        parent_item_id,
        production_date,
        week_start,
        plannedQtyResult.value,
        changeoverQtyResult.value,
        status,
        supervisor_user_id || null,
        created_by || null,
      ]
    );

    response.status(201).json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Failed to create planning entry:", error);

    response.status(500).json({
      success: false,
      error: "Failed to create planning entry",
    });
  }
});
router.patch("/planning/:id", async (request, response) => {
  try {
    const { id } = request.params;

    const {
      department_id,
      machine_id,
      shift_id,
      parent_item_id,
      production_date,
      week_start,
      planned_qty,
      changeover_qty,
      status,
      supervisor_user_id,
    } = request.body || {};

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
      return response.status(400).json({
        success: false,
        error: "Invalid planning entry ID",
      });
    }

    const existingRows = await postgres.query(
      `
      SELECT *
      FROM planning_entries
      WHERE id = $1
      `,
      [id]
    );
	

    if (existingRows.length === 0) {
      return response.status(404).json({
        success: false,
        error: "Planning entry not found",
      });
    }

    const existing = existingRows[0];
    const errors = [];

    const newDepartmentId =
      department_id !== undefined
        ? department_id
        : existing.department_id;

    const newMachineId =
      machine_id !== undefined
        ? machine_id || null
        : existing.machine_id;

    const newShiftId =
      shift_id !== undefined
        ? shift_id
        : existing.shift_id;

    const newParentItemId =
      parent_item_id !== undefined
        ? parent_item_id
        : existing.parent_item_id;

    const newProductionDate =
      production_date !== undefined
        ? production_date
        : existing.production_date;

    const newWeekStart =
      week_start !== undefined
        ? week_start
        : existing.week_start;

    const newPlannedQty =
      planned_qty !== undefined
        ? planned_qty
        : existing.planned_qty;

    const newChangeoverQty =
      changeover_qty !== undefined
        ? changeover_qty
        : existing.changeover_qty;

    const newStatus =
      status !== undefined
        ? status
        : existing.status;

    const newSupervisorUserId =
      supervisor_user_id !== undefined
        ? supervisor_user_id || null
        : existing.supervisor_user_id;

    const uuidFields = {
      department_id: newDepartmentId,
      machine_id: newMachineId,
      shift_id: newShiftId,
      parent_item_id: newParentItemId,
      supervisor_user_id: newSupervisorUserId,
    };

    for (const [field, value] of Object.entries(uuidFields)) {
      if (value !== null && value !== undefined && value !== "") {
        if (!uuidPattern.test(String(value))) {
          errors.push(`${field} must be a valid UUID`);
        }
      }
    }

    const productionDateString = toDateOnlyString(newProductionDate);
    const weekStartString = toDateOnlyString(newWeekStart);

    if (!isValidDateOnly(productionDateString)) {
      errors.push("production_date must use YYYY-MM-DD");
    }

    if (!isValidDateOnly(weekStartString)) {
      errors.push("week_start must use YYYY-MM-DD");
    }

    const plannedQtyResult = parseNonNegativeNumber(newPlannedQty);
    const changeoverQtyResult = parseNonNegativeNumber(newChangeoverQty);

    if (!plannedQtyResult.valid) {
      errors.push("planned_qty must be a non-negative number");
    }

    if (!changeoverQtyResult.valid) {
      errors.push("changeover_qty must be a non-negative number");
    }
    if (!isValidPlanningStatus(newStatus)) {
      errors.push(
        `status must be one of: ${PLANNING_STATUSES.join(", ")}`
      );
    }

    if (errors.length > 0) {
      return response.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      });
    }

    const departmentRows = await postgres.query(
      `
      SELECT id, is_active
      FROM departments
      WHERE id = $1
      `,
      [newDepartmentId]
    );

    if (departmentRows.length === 0) {
      errors.push("department_id does not exist");
    } else if (!departmentRows[0].is_active) {
      errors.push("department_id is inactive");
    }

    const shiftRows = await postgres.query(
      `
      SELECT id, department_id, is_active
      FROM shifts
      WHERE id = $1
      `,
      [newShiftId]
    );

    if (shiftRows.length === 0) {
      errors.push("shift_id does not exist");
    } else {
      if (!shiftRows[0].is_active) {
        errors.push("shift_id is inactive");
      }
      if (String(shiftRows[0].department_id) !== String(newDepartmentId)) {
        errors.push("shift_id does not belong to department_id");
      }
    }

    const itemRows = await postgres.query(
      `
      SELECT id, is_active
      FROM items
      WHERE id = $1
      `,
      [newParentItemId]
    );

    if (itemRows.length === 0) {
      errors.push("parent_item_id does not exist");
    } else if (!itemRows[0].is_active) {
      errors.push("parent_item_id is inactive");
    }

    if (newMachineId) {
      const machineRows = await postgres.query(
        `
        SELECT id, department_id, is_active
        FROM machines
        WHERE id = $1
        `,
        [newMachineId]
      );

      if (machineRows.length === 0) {
        errors.push("machine_id does not exist");
      } else {
        if (!machineRows[0].is_active) {
          errors.push("machine_id is inactive");
        }
        if (String(machineRows[0].department_id) !== String(newDepartmentId)) {
          errors.push("machine_id does not belong to department_id");
        }
      }
    }

    if (newSupervisorUserId) {
      const supervisorRows = await postgres.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
        `,
        [newSupervisorUserId]
      );

      if (supervisorRows.length === 0) {
        errors.push("supervisor_user_id does not exist");
      }
    }

    if (errors.length > 0) {
      return response.status(400).json({
        success: false,
        error: "Foreign-key validation failed",
        details: errors,
      });
    }

    const updatedRows = await postgres.query(
      `
      UPDATE planning_entries
      SET
        department_id = $1,
        machine_id = $2,
        shift_id = $3,
        parent_item_id = $4,
        production_date = $5,
        week_start = $6,
        planned_qty = $7,
        changeover_qty = $8,
        status = $9,
        supervisor_user_id = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
      `,
      [
        newDepartmentId,
        newMachineId,
        newShiftId,
        newParentItemId,
        productionDateString,
        weekStartString,
        plannedQtyResult.value,
        changeoverQtyResult.value,
        newStatus,
        newSupervisorUserId,
        id,
      ]
    );

    response.json({
      success: true,
      data: updatedRows[0],
    });
  } catch (error) {
    console.error("Failed to update planning entry:", error);

    response.status(500).json({
      success: false,
      error: "Failed to update planning entry",
    });
  }
});
router.get("/planning/:id", async (request, response) => {
  try {
    const { id } = request.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
      return response.status(400).json({
        success: false,
        error: "Invalid planning entry ID",
      });
    }

    const rows = await postgres.query(
      `
      SELECT
        p.id,
        p.production_date,
        p.week_start,
        p.planned_qty,
        p.changeover_qty,
        p.status,

        p.department_id,
        d.code AS department_code,
        d.name AS department_name,

        p.machine_id,
        m.code AS machine_code,
        m.name AS machine_name,

        p.shift_id,
        s.code AS shift_code,
        s.name AS shift_name,
        s.start_time,
        s.end_time,

        p.parent_item_id,
        i.stock_code AS parent_stock_code,
        i.description AS parent_description,

        p.supervisor_user_id,
        su.username AS supervisor_username,
        su.full_name AS supervisor_name,

        p.created_by,
        cu.username AS created_by_username,
        cu.full_name AS created_by_name,

        p.created_at,
        p.updated_at

      FROM planning_entries p

      JOIN departments d
        ON p.department_id = d.id

      LEFT JOIN machines m
        ON p.machine_id = m.id

      JOIN shifts s
        ON p.shift_id = s.id

      JOIN items i
        ON p.parent_item_id = i.id

      LEFT JOIN users su
        ON p.supervisor_user_id = su.id

      LEFT JOIN users cu
        ON p.created_by = cu.id

      WHERE p.id = $1
      `,
      [id]
    );

    if (rows.length === 0) {
      return response.status(404).json({
        success: false,
        error: "Planning entry not found",
      });
    }

    response.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("Failed to load planning entry:", error);

    response.status(500).json({
      success: false,
      error: "Failed to load planning entry",
    });
  }
});
router.delete("/planning/:id", async (request, response) => {
  let client;
  let transactionStarted = false;

  try {
    const { id } = request.params;

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(id)) {
      return response.status(400).json({
        success: false,
        error: "Invalid planning entry ID",
      });
    }

    client = await postgres.pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const existingResult = await client.query(
      `
      SELECT
        id,
        production_date,
        planned_qty,
        status
      FROM planning_entries
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return response.status(404).json({
        success: false,
        error: "Planning entry not found",
      });
    }

    const existing = existingResult.rows[0];

    if (existing.status !== "Planned") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return response.status(409).json({
        success: false,
        error: "Only untouched Planned entries may be permanently deleted",
      });
    }

    const dependencyResult = await client.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM production_actuals
        WHERE planning_entry_id = $1

        UNION ALL

        SELECT 1
        FROM material_requirements
        WHERE planning_entry_id = $1

        UNION ALL

        SELECT 1
        FROM material_reconciliations
        WHERE planning_entry_id = $1

        UNION ALL

        SELECT 1
        FROM oee_runs
        WHERE planning_entry_id = $1
      ) AS has_dependencies
      `,
      [id]
    );

    if (dependencyResult.rows[0].has_dependencies) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return response.status(409).json({
        success: false,
        error: "Planning entry has operational history and cannot be permanently deleted",
      });
    }

    const deletedResult = await client.query(
      `
      DELETE FROM planning_entries
      WHERE id = $1
      RETURNING
        id,
        production_date,
        planned_qty,
        status
      `,
      [id]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    response.json({
      success: true,
      message: "Planning entry deleted",
      data: deletedResult.rows[0],
    });
  } catch (error) {
    if (transactionStarted && client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Failed to roll back planning entry deletion:", rollbackError);
      }
    }

    if (error.code === "23503") {
      return response.status(409).json({
        success: false,
        error: "Planning entry has operational history and cannot be permanently deleted",
      });
    }

    console.error("Failed to delete planning entry:", error);

    response.status(500).json({
      success: false,
      error: "Failed to delete planning entry",
    });
  } finally {
    if (client) client.release();
  }
});
module.exports = router;
